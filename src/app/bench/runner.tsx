"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserEngine } from "@/lib/engine/browser-engine";
import { getModel } from "@/lib/engine/models";
import type { LanguageChoice } from "@/lib/engine/types";

interface ManifestItem {
  id: string;
  bucket: string;
  clip: string;
  duration: number;
}

export interface BenchOutput {
  run: string;
  engine: string;
  model: string;
  precision: string;
  language: string;
  device: string;
  model_load_seconds: number;
  audio_seconds: number;
  inference_seconds: number;
  realtime_factor: number;
  hypotheses: { id: string; hypothesis: string; language: string | null }[];
  errors: { id: string; message: string }[];
}

declare global {
  interface Window {
    __bench?: { status: "running" | "done" | "error"; done: number; total: number; output?: BenchOutput; error?: string };
  }
}

/** Parse a 16 kHz mono PCM16 WAV (the format build_subset.py writes). */
function parseWav(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  let off = 12;
  while (off < view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, off, 4));
    const size = view.getUint32(off + 4, true);
    if (id === "data") {
      const pcm = new Int16Array(buf, off + 8, size / 2);
      return Float32Array.from(pcm, (s) => s / 32768);
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export default function BenchRunner() {
  const [log, setLog] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(location.search);
    const modelId = q.get("model") ?? "whisper-large-v3-turbo";
    const variantIdx = Number(q.get("variant") ?? 0);
    const language = (q.get("language") ?? "auto") as LanguageChoice;
    const limit = Number(q.get("limit") ?? 0);
    const only = q.get("bucket");
    const say = (s: string) => setLog((l) => [...l.slice(-200), s]);

    (async () => {
      const model = getModel(modelId);
      const variant = model.variants[variantIdx];
      const engine = new BrowserEngine();
      const caps = await engine.getCapabilities();
      say(`device: ${caps.gpuDescription ?? "no webgpu"} f16=${caps.shaderF16} coi=${caps.crossOriginIsolated}`);

      const t0 = performance.now();
      // Benchmarks measure raw speed: no duty-cycle throttling.
      await engine.loadModel(modelId, undefined, variant, "max");
      const loadSeconds = (performance.now() - t0) / 1000;
      say(`loaded ${modelId} ${JSON.stringify(variant.dtype)} in ${loadSeconds.toFixed(1)}s`);

      let manifest: ManifestItem[] = await (await fetch("/bench-data/manifest.json")).json();
      if (only) manifest = manifest.filter((m) => m.bucket === only);
      if (limit) manifest = manifest.slice(0, limit);
      window.__bench = { status: "running", done: 0, total: manifest.length };

      const hypotheses: BenchOutput["hypotheses"] = [];
      const errors: BenchOutput["errors"] = [];
      let audio = 0;
      let infer = 0;
      for (const [i, item] of manifest.entries()) {
        const pcm = parseWav(await (await fetch(`/bench-data/${item.clip}`)).arrayBuffer());
        // Read before transcribing: the buffer is transferred (detached) to the worker.
        const seconds = pcm.length / 16000;
        const file = new File([], `${item.id}.wav`);
        const t = performance.now();
        try {
          const tr = await engine.transcribePcm(file, pcm, { modelId, language, profile: "max" }, () => {});
          infer += (performance.now() - t) / 1000;
          audio += seconds;
          const text = tr.segments.map((s) => s.text).join(" ");
          hypotheses.push({ id: item.id, hypothesis: text, language: tr.detectedLanguages.join(",") || null });
          if (i % 10 === 0) say(`${i}/${manifest.length} [${item.bucket}] ${text.slice(0, 100)}`);
        } catch (err) {
          errors.push({ id: item.id, message: String(err) });
          say(`ERROR ${item.id}: ${err}`);
        }
        window.__bench = { status: "running", done: i + 1, total: manifest.length };
      }

      const d = variant.dtype;
      const output: BenchOutput = {
        run: `browser__${modelId}__${d.encoder_model}-${d.decoder_model_merged}__${variant.engine.replace("browser-", "")}__${language}`,
        engine: `transformers.js ${variant.engine}`,
        model: model.hfRepo,
        precision: `enc ${d.encoder_model} / dec ${d.decoder_model_merged}`,
        language,
        device: caps.gpuDescription ?? "cpu",
        model_load_seconds: Math.round(loadSeconds * 10) / 10,
        audio_seconds: Math.round(audio * 10) / 10,
        inference_seconds: Math.round(infer * 10) / 10,
        realtime_factor: Math.round((audio / infer) * 100) / 100,
        hypotheses,
        errors,
      };
      window.__bench = { status: "done", done: manifest.length, total: manifest.length, output };
      say(`done: ${audio.toFixed(0)}s audio in ${infer.toFixed(0)}s = ${(audio / infer).toFixed(2)}x realtime`);
    })().catch((err) => {
      // WebKit stacks omit the message, so always include name + message.
      window.__bench = { status: "error", done: 0, total: 0, error: `${err?.name}: ${err?.message}\n${err?.stack ?? ""}` };
      say(`FATAL ${err}`);
    });
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-4 text-base font-semibold">Engine benchmark</h1>
      {log.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </main>
  );
}
