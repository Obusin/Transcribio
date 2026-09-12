import { getModel, pickVariant, type ModelVariant } from "./models";
import type { Capabilities } from "./types";

/**
 * How much of the user's machine a transcription may use.
 *
 * Local transcription is heavy: left unchecked it pins the GPU at 100% for the
 * whole file, and on shared-memory GPUs (most laptops) the model competes with
 * the OS for RAM. Each profile bounds three things:
 *
 *  - GPU duty cycle: after every chunk the worker rests for a share of the time
 *    that chunk took, so the GPU, fans and other apps get breathing room.
 *    (It does not shorten any single GPU job — on very weak GPUs, the smaller
 *    Light model is what reduces per-job time.)
 *  - CPU threads for ONNX Runtime WASM (the CPU engine and the VAD). ORT's
 *    worker threads spin-wait, so on WebGPU (where WASM only runs the tiny VAD)
 *    we use one: median CPU on a 45-min file went 77% → 40% (Balanced), 16% (Light).
 *  - Model memory: Light uses the q4f16 build (~25% lower peak RAM).
 *
 * Separately, the engine releases the whole worker 60 s after a job ends —
 * the only way to hand back ONNX Runtime's WASM heap, which never shrinks.
 */
export type ResourceProfile = "light" | "balanced" | "max";

export interface ProfileSpec {
  label: string;
  hint: string;
  /** Fraction of wall time the GPU is allowed to be busy (1 = no rests). */
  gpuDuty: number;
  /** Upper bound on WASM threads; the actual count also leaves cores free. */
  maxThreads: number;
  compactModel: boolean;
}

export const PROFILES: Record<ResourceProfile, ProfileSpec> = {
  light: {
    label: "Light",
    hint: "Slower. Keeps your computer cool and responsive.",
    gpuDuty: 0.5,
    maxThreads: 2,
    compactModel: true,
  },
  balanced: {
    label: "Balanced",
    hint: "Recommended. Fast, with room left for other apps.",
    gpuDuty: 0.75,
    maxThreads: 4,
    compactModel: false,
  },
  max: {
    label: "Maximum",
    hint: "Fastest. Uses your GPU flat out — best when you're away.",
    gpuDuty: 1,
    maxThreads: 8,
    compactModel: false,
  },
};

/** Rest time after a unit of GPU work that took `busyMs`, for the given duty cycle. */
export function restMs(busyMs: number, gpuDuty: number): number {
  if (gpuDuty >= 1) return 0;
  return Math.min(10_000, busyMs * (1 / Math.max(gpuDuty, 0.1) - 1));
}

/** WASM thread count: never more than the profile allows, and always leave cores for the OS and UI. */
export function wasmThreads(profile: ResourceProfile, hardwareConcurrency: number, engine: ModelVariant["engine"]): number {
  // On WebGPU the only WASM work is the tiny VAD model; threads just add overhead.
  if (engine === "browser-webgpu") return 1;
  const leaveFree = profile === "max" ? 1 : 2;
  return Math.max(1, Math.min(PROFILES[profile].maxThreads, hardwareConcurrency - leaveFree));
}

/** True when the device looks too small for the standard model build. */
export function isConstrained(caps: Capabilities): boolean {
  if (!caps.webgpu) return true;
  if (caps.deviceMemoryGB != null && caps.deviceMemoryGB <= 4) return true;
  // Small max-buffer limits correlate with integrated / low-VRAM GPUs.
  if (caps.maxBufferSizeMB != null && caps.maxBufferSizeMB < 1024) return true;
  // Intel integrated graphics share system RAM with everything else. Chrome
  // caps deviceMemory at 8, so an 8 GB laptop looks "big" — go by the GPU instead.
  // (Intel Arc discrete cards report Xe-HPG / Alchemist / Battlemage.)
  const gpu = (caps.gpuDescription ?? "").toLowerCase();
  if (gpu.includes("intel") && !/xe-hpg|alchemist|battlemage|\barc\b/.test(gpu)) return true;
  return false;
}

export function defaultProfile(caps: Capabilities | null): ResourceProfile {
  return caps && isConstrained(caps) ? "light" : "balanced";
}

export function chooseVariant(modelId: string, caps: Capabilities, profile: ResourceProfile): ModelVariant | null {
  const compact = PROFILES[profile].compactModel || isConstrained(caps);
  return pickVariant(getModel(modelId), { webgpu: caps.webgpu, shaderF16: caps.shaderF16, compact });
}
