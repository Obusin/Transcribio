/// <reference lib="webworker" />
/**
 * Local ASR worker. Everything heavy happens here, off the main thread:
 * streaming decode → 16 kHz → Silero VAD → speech chunks → Whisper.
 *
 * The media file never leaves the device; only progress and text are posted back.
 */

// Transformers.js must be imported before onnxruntime-web: it configures the
// shared ORT runtime (WASM paths, WebGPU preferences) at module load.
import { pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import * as ort from "onnxruntime-web/webgpu";

import { SpeechChunker, VAD_FRAME, type AudioChunk } from "../../audio/chunker";
import { DecodeInterruptedError, decodeToPcm16k, UnsupportedCodecError } from "../../audio/decode";
import { TARGET_RATE } from "../../audio/resample";
import { collapseRepeats, isLikelyHallucination } from "../../transcript/cleanup";
import { getModel, type ModelVariant } from "../models";
import { restMs } from "../resources";
import type { LanguageChoice, ProgressEvent, Segment, Transcript } from "../types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);
const progress = (event: ProgressEvent) => post({ type: "progress", event });

const SILERO_URL = "https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx";
const MODEL_CACHE = "transcribio-models";
/** Detect the file's language from this much speech before locking it in. */
const LANGUAGE_PROBE_SECONDS = 45;
const LANGUAGE_CANDIDATES = ["en", "tl"] as const;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey: string | null = null;
let vadSession: ort.InferenceSession | null = null;

let cancelled = false;
let keepPartial = false;
let paused = false;
let resumeWaiters: (() => void)[] = [];
/** Share of wall time the GPU may be busy; the worker rests in between. */
let gpuDuty = 1;
let wakeRest: (() => void) | null = null;
let runtimeInitialized = false;

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "load":
        if (!runtimeInitialized) {
          // Must be set before the first ONNX session is created; fixed afterwards.
          ort.env.wasm.numThreads = msg.threads;
          runtimeInitialized = true;
        }
        await loadModel(msg.modelId, msg.variant);
        post({ type: "loaded" });
        break;
      case "transcribe": {
        cancelled = false;
        keepPartial = false;
        paused = false;
        gpuDuty = msg.gpuDuty;
        const transcript = await transcribe(msg);
        if (transcript) post({ type: "result", transcript });
        else post({ type: "cancelled" });
        break;
      }
      case "set-duty":
        gpuDuty = msg.gpuDuty;
        wakeRest?.();
        break;
      case "cancel":
        cancelled = true;
        keepPartial = !!msg.keepPartial;
        setPaused(false);
        wakeRest?.();
        break;
      case "pause":
        setPaused(true);
        break;
      case "resume":
        setPaused(false);
        break;
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    post({ type: "error", name: error.name, message: error.message });
  }
};

function setPaused(p: boolean) {
  paused = p;
  if (!p) {
    resumeWaiters.forEach((r) => r());
    resumeWaiters = [];
  }
}

async function waitIfPaused() {
  if (paused) await new Promise<void>((r) => resumeWaiters.push(r));
}

/**
 * Run a unit of GPU work, then rest in proportion to how long it took, so the
 * GPU is busy at most `gpuDuty` of the time. Rests end early on cancel or when
 * the user changes the performance level.
 */
async function throttled<T>(work: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const result = await work();
  const ms = restMs(performance.now() - t0, gpuDuty);
  if (ms > 0 && !cancelled) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wakeRest = null;
        resolve();
      }
      wakeRest = done;
    });
  }
  return result;
}

// ─── Model loading ──────────────────────────────────────────────────────────

async function loadModel(modelId: string, variant: ModelVariant) {
  const key = `${modelId}|${variant.engine}|${JSON.stringify(variant.dtype)}`;
  if (asr && loadedKey === key) return;
  if (asr) {
    await asr.dispose();
    asr = null;
  }
  const model = getModel(modelId);

  // Transformers.js reports per-file progress; aggregate it into one bar.
  const files = new Map<string, { loaded: number; total: number }>();
  const report = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== "progress" || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    progress({ stage: "loading-model", loadedBytes: loaded, totalBytes: Math.max(total, variant.downloadMB * 1e6), file: info.file });
  };

  // Model files are large and come over the network; a dropped connection
  // ("Load failed" in Safari, "Failed to fetch" in Chromium) shouldn't end the job.
  // Files that finished downloading are already cached, so a retry resumes cheaply.
  for (let attempt = 1; ; attempt++) {
    try {
      asr = (await pipeline("automatic-speech-recognition", model.hfRepo, {
        device: variant.engine === "browser-webgpu" ? "webgpu" : "wasm",
        dtype: variant.dtype,
        progress_callback: report,
      })) as AutomaticSpeechRecognitionPipeline;
      break;
    } catch (err) {
      if (attempt >= 3 || !isNetworkError(err)) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  loadedKey = key;

  if (!vadSession) {
    vadSession = await ort.InferenceSession.create(await fetchCached(SILERO_URL), {
      executionProviders: ["wasm"],
    });
  }
}

function isNetworkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return e?.name === "TypeError" && /load failed|failed to fetch|networkerror|network connection/i.test(e.message ?? "");
}

async function fetchCached(url: string): Promise<Uint8Array> {
  const cache = await caches.open(MODEL_CACHE);
  let res = await cache.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
    await cache.put(url, res.clone());
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ─── VAD ────────────────────────────────────────────────────────────────────

function createVad() {
  const session = vadSession!;
  // Silero v5 expects the last 64 samples of the previous frame prepended.
  // Without it speech recall drops sharply (measured: 0.53 vs 0.70 on Taglish).
  const CONTEXT = 64;
  let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(TARGET_RATE)]), []);
  const input = new Float32Array(CONTEXT + VAD_FRAME);
  return async (frame: Float32Array): Promise<number> => {
    input.set(frame, CONTEXT);
    const out = await session.run({
      input: new ort.Tensor("float32", input.slice(), [1, CONTEXT + VAD_FRAME]),
      state,
      sr,
    });
    state = out.stateN as ort.Tensor;
    input.copyWithin(0, VAD_FRAME, VAD_FRAME + CONTEXT);
    return (out.output.data as Float32Array)[0];
  };
}

// ─── Language detection ─────────────────────────────────────────────────────

/**
 * Transformers.js does NOT auto-detect language: with `language` unset it
 * silently decodes as English, which makes Whisper *translate* Tagalog.
 * So we run one decoder step ourselves and compare the language-token logits,
 * restricted to the languages the product supports.
 */
async function languageScores(audio: Float32Array): Promise<Record<string, number>> {
  const pipe = asr!;
  const inputs = await pipe.processor(audio);
  const gc = pipe.model.generation_config as unknown as {
    decoder_start_token_id: number;
    lang_to_id: Record<string, number>;
  };
  const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const out = await pipe.model({ ...inputs, decoder_input_ids });
  let logits = out.logits as Tensor;
  if (logits.type !== "float32") logits = logits.to("float32");
  const data = logits.data as Float32Array;
  // Calling the model directly hands us the decoder KV cache as GPU buffers.
  // Nothing else frees them — without this, every probe leaks GPU memory.
  await (out.past_key_values as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
  for (const v of Object.values(out)) {
    const t = v as { location?: string; dispose?: () => void };
    if (t?.location === "gpu-buffer") t.dispose?.();
  }
  const scores = LANGUAGE_CANDIDATES.map((l) => data[gc.lang_to_id[`<|${l}|>`]]);
  const max = Math.max(...scores);
  const exp = scores.map((s) => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return Object.fromEntries(LANGUAGE_CANDIDATES.map((l, i) => [l, exp[i] / sum]));
}

// ─── Transcription ──────────────────────────────────────────────────────────

async function transcribe(req: Extract<WorkerRequest, { type: "transcribe" }>): Promise<Transcript | null> {
  if (!asr || !vadSession) throw new Error("Model not loaded");
  const started = performance.now();
  const chunker = new SpeechChunker(createVad());
  const segments: Segment[] = [];
  const detected = new Set<string>();

  let language: string | null = req.options.language === "auto" ? null : req.options.language;
  const probe: AudioChunk[] = [];
  let probeSeconds = 0;
  const langVotes: Record<string, number> = { en: 0, tl: 0 };
  let durationSeconds = req.durationSeconds;
  /** Where in the media this run starts; the chunker's clock starts at 0, so shift by this. */
  const offset = req.startAt ?? 0;
  /** Media time up to which audio has actually been transcribed. */
  let transcribedUntil = offset;
  const unreadable: { start: number; end: number }[] = [];

  const finish = (stopped: boolean): Transcript => {
    durationSeconds = Math.max(durationSeconds, offset + chunker.seconds);
    const processingSeconds = (performance.now() - started) / 1000;
    const covered = (stopped ? transcribedUntil : durationSeconds) - offset;
    progress({ stage: "done" });
    return {
      segments,
      durationSeconds,
      modelId: req.options.modelId,
      engine: req.engine,
      language: req.options.language,
      detectedLanguages: [...detected],
      createdAt: new Date().toISOString(),
      ...(stopped ? { partial: { stoppedAtSeconds: transcribedUntil } } : {}),
      ...(unreadable.length ? { unreadable } : {}),
      stats: { processingSeconds, realtimeFactor: covered / Math.max(processingSeconds, 1e-3) },
    };
  };
  // Cancelled: hand back the work done so far if asked to, otherwise nothing.
  const stop = () => (keepPartial && segments.length ? finish(true) : null);

  const emitProgress = (processed: number) => {
    const wall = (performance.now() - started) / 1000;
    progress({
      stage: "transcribing",
      processedSeconds: Math.min(processed, durationSeconds),
      durationSeconds,
      // Only report speed once it's measured over a meaningful window.
      realtimeFactor: processed >= 30 && wall >= 5 ? processed / wall : null,
    });
  };

  const runChunk = async (chunk: AudioChunk) => {
    const lang = language!;
    detected.add(lang);
    const out = await throttled(() =>
      asr!(chunk.audio, {
        language: lang,
        task: "transcribe", // never translate
        return_timestamps: true,
        // Bounding output length is the cheapest guard against repetition loops.
        max_new_tokens: Math.min(440, Math.ceil((chunk.end - chunk.start) * 9) + 24),
      } as Record<string, unknown>),
    );
    const result = Array.isArray(out) ? out[0] : out;
    const pieces = (result.chunks as { text: string; timestamp: [number, number | null] }[] | undefined) ?? [
      { text: result.text, timestamp: [0, chunk.end - chunk.start] },
    ];
    for (const p of pieces) {
      const text = collapseRepeats(p.text.trim());
      if (!text) continue;
      // Mostly-non-speech chunks (music, noise) are where Whisper invents
      // outro phrases. Drop those — but keep real speech found under music.
      if (chunk.speechRatio < 0.3 && isLikelyHallucination(text)) continue;
      const start = chunk.start + (p.timestamp[0] ?? 0);
      const end = Math.min(chunk.end, chunk.start + (p.timestamp[1] ?? chunk.end - chunk.start));
      const seg: Segment = { id: segments.length, start, end: Math.max(end, start), text, language: lang };
      segments.push(seg);
      progress({ stage: "segment", segment: seg });
    }
    transcribedUntil = chunk.end;
    emitProgress(chunk.end);
  };

  const handleChunks = async (raw: AudioChunk[]) => {
    const chunks = offset ? raw.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset })) : raw;
    for (const chunk of chunks) {
      await waitIfPaused();
      if (cancelled) return;
      if (!language) {
        // Accumulate the first ~45 s of speech, vote, then lock the language.
        const scores = await throttled(() => languageScores(chunk.audio));
        // Music/noise chunks shouldn't get a say in the language vote.
        const w = (chunk.end - chunk.start) * Math.max(chunk.speechRatio, 0.05);
        for (const l of LANGUAGE_CANDIDATES) langVotes[l] += scores[l] * w;
        probe.push(chunk);
        probeSeconds += chunk.end - chunk.start;
        if (probeSeconds < LANGUAGE_PROBE_SECONDS) continue;
        language = resolveLanguage(langVotes);
        for (const c of probe.splice(0)) {
          if (cancelled) return;
          await runChunk(c);
        }
        continue;
      }
      await runChunk(chunk);
    }
  };

  progress({ stage: "preparing", message: "Reading audio" });
  const abort = new AbortController();
  const source: AsyncIterable<Float32Array> = req.pcm ? blocksOf(req.pcm) : decodeToPcm16k(req.file!, abort.signal, (start, end) => unreadable.push({ start, end }), offset);

  // Batch the decoder's small blocks into ~2 s pushes to keep per-call overhead low.
  let batch: Float32Array[] = [];
  let batchLen = 0;
  let lastReport = 0;
  let interrupted = false;
  try {
    for await (const block of source) {
      if (cancelled) break;
      batch.push(block);
      batchLen += block.length;
      if (batchLen < TARGET_RATE * 2) continue;
      await handleChunks(await chunker.push(concat(batch, batchLen)));
      batch = [];
      batchLen = 0;
      // While scanning silence there are no chunks; still show movement.
      if (chunker.seconds - lastReport > 5 && segments.length === 0) {
        lastReport = chunker.seconds;
        progress({ stage: "preparing", message: "Finding speech" });
      }
    }
  } catch (err) {
    if (err instanceof UnsupportedCodecError) {
      post({ type: "needs-pcm", reason: err.message });
      return null;
    }
    // A cut-off recording: keep and transcribe everything that decoded.
    if (err instanceof DecodeInterruptedError) interrupted = true;
    else throw err;
  } finally {
    abort.abort();
  }
  if (cancelled) return stop();
  if (batchLen) await handleChunks(await chunker.push(concat(batch, batchLen)));
  await handleChunks(await chunker.flush());
  // Short files may never reach the probe length.
  if (!language && probe.length) {
    language = resolveLanguage(langVotes);
    for (const c of probe.splice(0)) {
      if (cancelled) break;
      await runChunk(c);
    }
  }
  if (cancelled) return stop();
  return finish(interrupted);
}

/**
 * Decode Taglish as Tagalog unless the audio is clearly English: Whisper's `tl`
 * mode keeps English words in English, while `en` mode translates Tagalog.
 * (Threshold validated in MODEL_BENCHMARK.md.)
 */
function resolveLanguage(votes: Record<string, number>): LanguageChoice {
  const total = votes.en + votes.tl || 1;
  return votes.en / total >= 0.8 ? "en" : "tl";
}

function concat(parts: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function* blocksOf(pcm: Float32Array): AsyncGenerator<Float32Array> {
  for (let i = 0; i < pcm.length; i += TARGET_RATE * 2) yield pcm.subarray(i, i + TARGET_RATE * 2);
}
