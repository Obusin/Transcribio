import type { EngineKind } from "./types";

/**
 * Model registry. Every model the product can run is declared here — the rest
 * of the app refers to models only by `id`.
 *
 * `downloadMB` values are the summed ONNX file sizes of the exact variant, read
 * from the Hugging Face repo listings on 2026-09-11. Re-verify when bumping a repo.
 */

export type OnnxDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export interface ModelVariant {
  engine: Extract<EngineKind, "browser-webgpu" | "browser-wasm">;
  dtype: { encoder_model: OnnxDtype; decoder_model_merged: OnnxDtype };
  downloadMB: number;
  /** WebGPU fp16 variants need the `shader-f16` feature. */
  requiresShaderF16?: boolean;
  /**
   * `compact` = smaller download and lower *peak* memory, used in Light mode and
   * on constrained devices (see resources.ts). Measured on an M4 (bench/variant_memory.mjs):
   * renderer peak while loading Turbo — fp16/q4 2.6 GB, q4f16 1.95 GB, q4 3.5 GB.
   * Download size is NOT memory: ONNX Runtime copies the model into its WASM heap,
   * and plain q4 ends up the heaviest in RAM. Terminating the worker frees it all.
   */
  footprint: "standard" | "compact";
}

export interface ASRModel {
  id: string;
  name: string;
  family: "whisper";
  hfRepo: string;
  languages: string[];
  capabilities: { segmentTimestamps: boolean; wordTimestamps: boolean; languageDetection: boolean };
  /** Ordered by preference; the first one the device supports is used. */
  variants: ModelVariant[];
  /** Short description shown in the model picker. */
  blurb: string;
  /** Candidates are selectable on /bench but hidden from normal users. */
  status: "recommended" | "available" | "candidate";
}

const WHISPER_LANGS = ["en", "tl"];

export const MODELS: ASRModel[] = [
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Turbo",
    family: "whisper",
    hfRepo: "onnx-community/whisper-large-v3-turbo",
    languages: WHISPER_LANGS,
    capabilities: { segmentTimestamps: true, wordTimestamps: false, languageDetection: true },
    // Index order is referenced by bench/run_browser.mjs --variant.
    // (An fp32-encoder variant, 2.9 GB, was removed: too heavy for the GPUs that lack fp16.)
    variants: [
      { engine: "browser-webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, downloadMB: 1608, requiresShaderF16: true, footprint: "standard" },
      { engine: "browser-webgpu", dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" }, downloadMB: 564, requiresShaderF16: true, footprint: "compact" },
      { engine: "browser-webgpu", dtype: { encoder_model: "q4", decoder_model_merged: "q4" }, downloadMB: 759, footprint: "compact" },
      { engine: "browser-wasm", dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, downloadMB: 1085, footprint: "standard" },
    ],
    blurb: "Best balance of accuracy and speed for English, Filipino and Taglish.",
    status: "recommended",
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    family: "whisper",
    hfRepo: "onnx-community/whisper-large-v3-ONNX",
    languages: WHISPER_LANGS,
    capabilities: { segmentTimestamps: true, wordTimestamps: false, languageDetection: true },
    variants: [
      { engine: "browser-webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, downloadMB: 2071, requiresShaderF16: true, footprint: "standard" },
      { engine: "browser-webgpu", dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" }, downloadMB: 980, requiresShaderF16: true, footprint: "compact" },
    ],
    blurb: "Largest model. Slower; for maximum accuracy on strong GPUs.",
    status: "candidate",
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    family: "whisper",
    hfRepo: "onnx-community/whisper-small",
    languages: WHISPER_LANGS,
    capabilities: { segmentTimestamps: true, wordTimestamps: false, languageDetection: true },
    variants: [
      { engine: "browser-webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, downloadMB: 410, requiresShaderF16: true, footprint: "compact" },
      { engine: "browser-wasm", dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, downloadMB: 249, footprint: "compact" },
    ],
    blurb: "Lightweight fallback for older hardware.",
    status: "candidate",
  },
];

export function getModel(id: string): ASRModel {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export function pickVariant(
  model: ASRModel,
  opts: { webgpu: boolean; shaderF16: boolean; forceEngine?: ModelVariant["engine"]; compact?: boolean },
): ModelVariant | null {
  const usable = model.variants.filter((v) => {
    if (opts.forceEngine && v.engine !== opts.forceEngine) return false;
    if (v.engine === "browser-webgpu" && !opts.webgpu) return false;
    if (v.requiresShaderF16 && !opts.shaderF16) return false;
    return true;
  });
  // Keep the best engine (WebGPU before WASM); within it, honour the footprint preference.
  const engine = usable[0]?.engine;
  const sameEngine = usable.filter((v) => v.engine === engine);
  const preferred = sameEngine.filter((v) => (v.footprint === "compact") === !!opts.compact);
  return preferred[0] ?? sameEngine[0] ?? null;
}
