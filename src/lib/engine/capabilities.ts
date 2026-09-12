import { MODELS, pickVariant } from "./models";
import type { Capabilities, Recommendation } from "./types";

/**
 * Probe what this browser/device can do. Runs entirely client-side; none of
 * this is sent to the server (privacy: section 20/25 of the product spec).
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(opts?: object): Promise<GPUAdapterLike | null> };
    deviceMemory?: number;
  };

  let webgpu = false;
  let gpuDescription: string | null = null;
  let shaderF16 = false;
  let maxBufferSizeMB: number | null = null;
  try {
    const adapter = await nav.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (adapter) {
      webgpu = true;
      shaderF16 = adapter.features.has("shader-f16");
      maxBufferSizeMB = Math.round(Number(adapter.limits.maxBufferSize) / 2 ** 20);
      const info = adapter.info;
      gpuDescription = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || null;
    }
  } catch {
    webgpu = false;
  }

  let storageAvailableMB: number | null = null;
  try {
    const est = await navigator.storage?.estimate();
    if (est?.quota != null) storageAvailableMB = Math.round((est.quota - (est.usage ?? 0)) / 2 ** 20);
  } catch {
    /* not available */
  }

  return {
    webgpu,
    gpuDescription,
    shaderF16,
    maxBufferSizeMB,
    webcodecs: typeof AudioDecoder !== "undefined",
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    deviceMemoryGB: nav.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    storageAvailableMB,
  };
}

interface GPUAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxBufferSize: number | bigint };
  info?: { vendor?: string; architecture?: string; description?: string };
}

/** Pick an engine + model. Qualitative only; speed is shown once measured. */
export function recommend(caps: Capabilities): Recommendation {
  const reasons: string[] = [];
  const primary = MODELS.find((m) => m.status === "recommended")!;
  const variant = pickVariant(primary, { webgpu: caps.webgpu, shaderF16: caps.shaderF16 });

  if (!caps.webcodecs) reasons.push("This browser lacks WebCodecs, so very large files may not open.");
  if (caps.storageAvailableMB != null && variant && caps.storageAvailableMB < variant.downloadMB * 1.2) {
    reasons.push("Not enough browser storage to cache the model.");
  }

  if (variant?.engine === "browser-webgpu") {
    reasons.push("Your GPU is available to the browser (WebGPU).");
    const weak = caps.maxBufferSizeMB != null && caps.maxBufferSizeMB < 1024;
    return { engine: "browser-webgpu", modelId: primary.id, tier: weak ? "good" : "excellent", reasons };
  }
  if (variant?.engine === "browser-wasm") {
    reasons.push("No WebGPU — transcription will run on your CPU, which is much slower.");
    return { engine: "browser-wasm", modelId: primary.id, tier: "limited", reasons };
  }
  return { engine: null, modelId: null, tier: "unsupported", reasons: [...reasons, "This browser can't run local transcription."] };
}
