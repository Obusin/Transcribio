import { getModel, type ModelVariant } from "./models";

/**
 * Model manager: what's downloaded, how big it is, and deleting it.
 * Transformers.js stores model files in Cache Storage under this name.
 */
const TRANSFORMERS_CACHE = "transformers-cache";

function variantFiles(repo: string, v: ModelVariant): string[] {
  const suffix = (d: string) => (d === "fp32" ? "" : d === "q8" ? "_quantized" : `_${d}`);
  return [
    `${repo}/resolve/main/onnx/encoder_model${suffix(v.dtype.encoder_model)}.onnx`,
    `${repo}/resolve/main/onnx/decoder_model_merged${suffix(v.dtype.decoder_model_merged)}.onnx`,
  ];
}

export interface CachedModelInfo {
  downloaded: boolean;
  /** Bytes currently stored for this model repo (all variants). */
  bytes: number;
}

export async function cachedModelInfo(modelId: string, variant: ModelVariant): Promise<CachedModelInfo> {
  if (typeof caches === "undefined") return { downloaded: false, bytes: 0 };
  const repo = getModel(modelId).hfRepo;
  const cache = await caches.open(TRANSFORMERS_CACHE);
  const keys = await cache.keys();
  const urls = keys.map((k) => k.url).filter((u) => u.includes(`/${repo}/`));
  const needed = variantFiles(repo, variant);
  const downloaded = needed.every((f) => urls.some((u) => u.endsWith(f)));
  let bytes = 0;
  for (const u of urls) {
    const res = await cache.match(u);
    bytes += Number(res?.headers.get("content-length") ?? 0);
  }
  return { downloaded, bytes };
}

export async function deleteModel(modelId: string): Promise<void> {
  const repo = getModel(modelId).hfRepo;
  const cache = await caches.open(TRANSFORMERS_CACHE);
  for (const req of await cache.keys()) {
    if (req.url.includes(`/${repo}/`)) await cache.delete(req);
  }
}

/** Ask the browser not to evict cached models under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
