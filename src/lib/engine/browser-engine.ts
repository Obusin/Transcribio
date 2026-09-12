import { AUDIO_CONTEXT_FALLBACK_MAX_BYTES, decodeWithAudioContext, probeMedia } from "../audio/decode";
import { detectCapabilities } from "./capabilities";
import { getModel, pickVariant, type ModelVariant } from "./models";
import { chooseVariant, PROFILES, wasmThreads, type ResourceProfile } from "./resources";
import {
  TranscriptionCancelled,
  type Capabilities,
  type EngineKind,
  type ProgressCallback,
  type Transcript,
  type TranscriptionEngine,
  type TranscriptionOptions,
} from "./types";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";

/**
 * In-browser engine (WebGPU, or WASM fallback). Owns one worker; the model stays
 * loaded between jobs so the second transcription starts instantly.
 *
 * Resource use follows a `ResourceProfile`: it picks the model build (standard
 * or compact), caps CPU threads, and sets the GPU duty cycle — which can be
 * changed while a job runs.
 */
export class BrowserEngine implements TranscriptionEngine {
  private worker: Worker | null = null;
  private workerThreads: number | null = null;
  private caps: Capabilities | null = null;
  private variant: ModelVariant | null = null;
  private loadedKey: string | null = null;
  private profile: ResourceProfile = "balanced";
  private listener: ((msg: WorkerResponse) => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rejects the in-flight request; used when the worker is torn down mid-request. */
  private rejectPending: ((err: Error) => void) | null = null;

  constructor(private readonly prefer?: ModelVariant["engine"]) {}

  get kind(): EngineKind {
    return this.variant?.engine ?? this.prefer ?? "browser-webgpu";
  }

  get activeVariant(): ModelVariant | null {
    return this.variant;
  }

  async initialize(threads = 1): Promise<void> {
    // ORT's thread count is fixed per worker; a different cap needs a fresh one.
    if (this.worker && this.workerThreads === threads) return;
    if (this.worker) await this.dispose();
    this.workerThreads = threads;
    this.worker = new Worker(new URL("./worker/asr.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.listener?.(e.data);
    this.worker.onerror = (e) => {
      this.listener?.({ type: "error", name: "WorkerError", message: e.message || "The transcription worker crashed." });
    };
  }

  async getCapabilities(): Promise<Capabilities> {
    this.caps ??= await detectCapabilities();
    return this.caps;
  }

  /** The variant `loadModel` would pick for this device and profile (for sizing UI). */
  async plannedVariant(modelId: string, profile: ResourceProfile): Promise<ModelVariant | null> {
    const caps = await this.getCapabilities();
    if (this.prefer) return pickVariant(getModel(modelId), { ...caps, forceEngine: this.prefer, compact: PROFILES[profile].compactModel });
    return chooseVariant(modelId, caps, profile);
  }

  /** `variantOverride` pins an exact quantization (used by /bench). */
  async loadModel(
    modelId: string,
    onProgress?: ProgressCallback,
    variantOverride?: ModelVariant,
    profile: ResourceProfile = this.profile,
  ): Promise<void> {
    this.profile = profile;
    this.cancelIdleRelease();
    const caps = await this.getCapabilities();
    const variant = variantOverride ?? (await this.plannedVariant(modelId, profile));
    if (!variant) throw new Error("This device can't run the selected model in the browser.");
    const threads = wasmThreads(profile, caps.hardwareConcurrency, variant.engine);
    await this.initialize(threads);
    const key = `${modelId}|${JSON.stringify(variant)}|${threads}`;
    if (key === this.loadedKey) return;
    this.variant = variant;
    await this.request({ type: "load", modelId, variant, threads }, (msg) => {
      if (msg.type === "progress") onProgress?.(msg.event);
      return msg.type === "loaded";
    });
    this.loadedKey = key;
  }

  /**
   * Free the model (GPU buffers, WASM heap — the whole worker) once nothing has
   * used it for `ms`. A loaded model holds 1–3 GB of GPU memory, which the user
   * shouldn't pay for while they're reading or editing a transcript. Reloading
   * from the browser cache takes seconds.
   */
  releaseWhenIdle(ms = 60_000) {
    this.cancelIdleRelease();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.dispose();
    }, ms);
  }

  private cancelIdleRelease() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Change how hard a running (or the next) job may push the device. */
  setProfile(profile: ResourceProfile) {
    this.profile = profile;
    this.worker?.postMessage({ type: "set-duty", gpuDuty: PROFILES[profile].gpuDuty } satisfies WorkerRequest);
  }

  private run(req: WorkerRequest, onProgress: ProgressCallback) {
    return this.request<Transcript | "needs-pcm">(req, (msg) => {
      if (msg.type === "progress") onProgress(msg.event);
      if (msg.type === "result") return msg.transcript;
      if (msg.type === "needs-pcm") return "needs-pcm";
      if (msg.type === "cancelled") throw new TranscriptionCancelled();
      return undefined;
    });
  }

  /** Transcribe already-decoded 16 kHz mono PCM (benchmarks, fallback decoding). */
  async transcribePcm(source: File, pcm: Float32Array, options: TranscriptionOptions, onProgress: ProgressCallback) {
    if (!this.variant) await this.loadModel(options.modelId, onProgress, undefined, options.profile);
    const gpuDuty = PROFILES[options.profile ?? this.profile].gpuDuty;
    const r = await this.run(
      { type: "transcribe", engine: this.kind, options, durationSeconds: pcm.length / 16000, gpuDuty, pcm, file: source },
      onProgress,
    );
    if (r === "needs-pcm") throw new Error("Unable to decode audio.");
    return r;
  }

  /**
   * `knownDuration` skips re-probing a file the UI already probed.
   * `startAt` (seconds) continues a partial transcript from that point.
   */
  async transcribe(
    source: File,
    options: TranscriptionOptions,
    onProgress: ProgressCallback,
    knownDuration?: number,
    startAt = 0,
  ): Promise<Transcript> {
    const profile = options.profile ?? this.profile;
    await this.loadModel(options.modelId, onProgress, undefined, profile);
    const duration = knownDuration ?? (await probeMedia(source).catch(() => null))?.durationSeconds ?? 0;
    const base = {
      type: "transcribe" as const,
      engine: this.kind,
      options,
      durationSeconds: duration,
      gpuDuty: PROFILES[profile].gpuDuty,
      startAt,
    };
    const run = (req: WorkerRequest) => this.run(req, onProgress);

    const first = await run({ ...base, file: source });
    if (first !== "needs-pcm") return first;

    // WebCodecs couldn't decode this codec. Fall back to the browser's own
    // decoder — which needs the whole file in memory, hence the cap.
    if (source.size > AUDIO_CONTEXT_FALLBACK_MAX_BYTES) {
      throw new Error("This browser can't decode this file's audio, and the file is too large for the backup decoder. Try Chrome or Edge.");
    }
    onProgress({ stage: "preparing", message: "Decoding audio" });
    const full = await decodeWithAudioContext(source);
    const pcm = startAt ? full.slice(Math.floor(startAt * 16000)) : full;
    const second = await run({ ...base, durationSeconds: full.length / 16000, pcm });
    if (second === "needs-pcm") throw new Error("Unable to decode audio.");
    return second;
  }

  pause() {
    this.worker?.postMessage({ type: "pause" } satisfies WorkerRequest);
  }

  resume() {
    this.worker?.postMessage({ type: "resume" } satisfies WorkerRequest);
  }

  /**
   * Stop the running job. With `keepPartial`, the job resolves with what has been
   * transcribed so far (marked `partial`); otherwise it rejects with TranscriptionCancelled.
   * Takes effect after the current chunk (a few seconds at most).
   */
  async cancel(keepPartial = false): Promise<void> {
    this.worker?.postMessage({ type: "cancel", keepPartial } satisfies WorkerRequest);
  }

  /** Abort a model download/load in progress. Terminating the worker is instant and frees everything. */
  async cancelLoading(): Promise<void> {
    await this.dispose();
  }

  async dispose(): Promise<void> {
    this.cancelIdleRelease();
    // Anything still waiting on this worker would otherwise hang forever.
    this.rejectPending?.(new TranscriptionCancelled());
    this.rejectPending = null;
    this.listener = null;
    this.worker?.terminate();
    this.worker = null;
    this.workerThreads = null;
    this.variant = null;
    this.loadedKey = null;
  }

  /** Send a request and resolve when `handle` returns a value (or throws). */
  private request<T>(req: WorkerRequest, handle: (msg: WorkerResponse) => T | undefined | false): Promise<T> {
    const worker = this.worker!;
    return new Promise<T>((resolve, reject) => {
      this.rejectPending = reject;
      this.listener = (msg) => {
        if (msg.type === "error") {
          this.listener = null;
          this.rejectPending = null;
          const err = new Error(msg.message);
          err.name = msg.name;
          reject(err);
          return;
        }
        try {
          const v = handle(msg);
          if (v !== undefined && v !== false) {
            this.listener = null;
            this.rejectPending = null;
            resolve(v as T);
          }
        } catch (err) {
          this.listener = null;
          this.rejectPending = null;
          reject(err);
        }
      };
      const transfer = req.type === "transcribe" && req.pcm ? [req.pcm.buffer] : [];
      worker.postMessage(req, transfer);
    });
  }
}
