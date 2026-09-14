import { getModel, pickVariant, type ModelVariant } from "./models";
import type { Capabilities } from "./types";

/**
 * How much of the user's machine a transcription may use.
 *
 * Local transcription is heavy: left unchecked it pins the GPU at 100% for the
 * whole file, and on shared-memory GPUs (most laptops) the model competes with
 * the OS for RAM. No profile ever uses the whole machine. Each one bounds:
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
  /**
   * Most of wall time the GPU may be busy. Always below 1: even Maximum rests
   * between chunks, so the machine is never pinned at 100%. The live figure can
   * be lower still — see adaptiveDuty.
   */
  gpuDuty: number;
  /** Share of the CPU cores the CPU engine may use, before the reserve below is kept free. */
  threadShare: number;
  compactModel: boolean;
}

export const PROFILES: Record<ResourceProfile, ProfileSpec> = {
  light: {
    label: "Light",
    hint: "Default. Uses about half your graphics card and a quarter of your cores, with a smaller model.",
    gpuDuty: 0.5,
    threadShare: 0.25,
    compactModel: true,
  },
  balanced: {
    label: "Balanced",
    hint: "Faster. Uses about 70% of your graphics card and half your cores.",
    gpuDuty: 0.7,
    threadShare: 0.5,
    compactModel: false,
  },
  max: {
    label: "Maximum",
    hint: "Fastest, but still leaves headroom: about 85% of your graphics card and 75% of your cores.",
    gpuDuty: 0.85,
    threadShare: 0.75,
    compactModel: false,
  },
};

/** The lowest the governor will throttle a struggling machine to. */
export const MIN_DUTY = 0.3;

/** Rest time after a unit of GPU work that took `busyMs`, for the given duty cycle. */
export function restMs(busyMs: number, gpuDuty: number): number {
  if (gpuDuty >= 1) return 0;
  return Math.min(10_000, busyMs * (1 / Math.max(gpuDuty, 0.1) - 1));
}

/**
 * The live duty cycle: the profile's figure while the machine keeps pace, less
 * when it starts struggling.
 *
 * `paces` are milliseconds of work per second of audio for recent chunks,
 * oldest first. Pace naturally wanders with how much is being said, so the
 * baseline is the lower quartile of 3-chunk medians (a typical good stretch,
 * not the single best one) and only a sustained 1.5× slowdown counts — the
 * kind heat-throttling or a heavy app in the background causes. Then the duty
 * is cut in proportion, giving the machine more rest until it recovers.
 */
export function adaptiveDuty(cap: number, paces: number[]): number {
  const limit = Math.min(cap, 0.95);
  if (paces.length < 6) return limit;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const windows: number[] = [];
  for (let i = 0; i + 3 <= paces.length; i++) windows.push(median(paces.slice(i, i + 3)));
  const baseline = [...windows].sort((a, b) => a - b)[Math.floor(windows.length / 4)];
  const recent = median(paces.slice(-3));
  const slowdown = recent / baseline;
  if (!Number.isFinite(slowdown) || slowdown < 1.5) return limit;
  return Math.max(MIN_DUTY, Math.min(limit, limit / slowdown));
}

/**
 * WASM thread count for the CPU engine: a share of the cores scaled to the
 * machine, with a reserve — a quarter of the cores, at least one — always left
 * for the OS, the browser and whatever else is running.
 */
export function wasmThreads(profile: ResourceProfile, hardwareConcurrency: number, engine: ModelVariant["engine"]): number {
  // On WebGPU the only WASM work is the tiny VAD model; threads just add overhead.
  if (engine === "browser-webgpu") return 1;
  const cores = Math.max(1, Math.floor(hardwareConcurrency));
  const reserve = Math.max(1, Math.ceil(cores * 0.25));
  const wanted = Math.floor(cores * PROFILES[profile].threadShare);
  // ONNX Runtime gains little past 8 threads.
  return Math.max(1, Math.min(wanted, cores - reserve, 8));
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

/**
 * Everyone starts on Light, whatever the machine. People raise it themselves if
 * they want more speed; nobody's computer gets pushed hard by default.
 * (The capabilities still decide the model build — see chooseVariant.)
 */
export function defaultProfile(caps: Capabilities | null): ResourceProfile {
  void caps; // kept in the signature: callers pass it, and a future default may use it
  return "light";
}

export function chooseVariant(modelId: string, caps: Capabilities, profile: ResourceProfile): ModelVariant | null {
  const compact = PROFILES[profile].compactModel || isConstrained(caps);
  return pickVariant(getModel(modelId), { webgpu: caps.webgpu, shaderF16: caps.shaderF16, compact });
}
