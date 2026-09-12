/**
 * Engine contracts. The UI only talks to `TranscriptionEngine`; nothing outside
 * `src/lib/engine` knows whether a transcript came from WebGPU, WASM, a desktop
 * helper or a cloud worker.
 */

export type ProcessingMode = "local" | "cloud";
export type EngineKind = "browser-webgpu" | "browser-wasm" | "desktop" | "cloud";

/** Languages the product is tuned for. `auto` = detect between these. */
export type LanguageChoice = "auto" | "en" | "tl";

export interface Capabilities {
  webgpu: boolean;
  /** Human-readable adapter description where the browser exposes it. Never sent to the server. */
  gpuDescription: string | null;
  /** `shader-f16` support — required for fp16 model variants on WebGPU. */
  shaderF16: boolean;
  /** Largest single GPU buffer; a rough proxy for how big a model the GPU can hold. */
  maxBufferSizeMB: number | null;
  webcodecs: boolean;
  crossOriginIsolated: boolean;
  /** navigator.deviceMemory (Chromium only, capped at 8). */
  deviceMemoryGB: number | null;
  hardwareConcurrency: number;
  /** Persistent-storage quota estimate, used to decide whether a model fits in cache. */
  storageAvailableMB: number | null;
}

export interface Recommendation {
  engine: EngineKind | null;
  modelId: string | null;
  /** Qualitative only — we never promise a speed we have not measured on this device. */
  tier: "excellent" | "good" | "limited" | "unsupported";
  reasons: string[];
}

export interface TranscriptionOptions {
  modelId: string;
  language: LanguageChoice;
  /** Timestamps are always on; this toggles word-level where the model supports it. */
  wordTimestamps?: boolean;
  /** How much of the device the job may use (see resources.ts). Defaults to balanced. */
  profile?: import("./resources").ResourceProfile;
}

export interface Segment {
  id: number;
  start: number; // seconds from media start
  end: number;
  text: string;
  /** Language actually decoded for the chunk this segment came from. */
  language: string;
  speaker?: string | null;
}

export interface Transcript {
  /** Immutable ASR output. Edits and AI cleanup live in separate layers. */
  segments: Segment[];
  durationSeconds: number;
  modelId: string;
  engine: EngineKind;
  language: LanguageChoice;
  detectedLanguages: string[];
  createdAt: string;
  /** Set when the user stopped early and kept what was done. */
  partial?: { stoppedAtSeconds: number };
  /** Stretches of the media that were damaged and skipped (silence in their place). */
  unreadable?: { start: number; end: number }[];
  stats: {
    processingSeconds: number;
    /** audio seconds / wall seconds, measured on this run. */
    realtimeFactor: number;
  };
}

export type ProgressEvent =
  | { stage: "loading-model"; loadedBytes: number; totalBytes: number; file?: string }
  | { stage: "preparing"; message: string }
  | {
      stage: "transcribing";
      processedSeconds: number;
      durationSeconds: number;
      /** Only present once enough audio has been processed to measure it. */
      realtimeFactor: number | null;
    }
  | { stage: "segment"; segment: Segment }
  | { stage: "done" };

export type ProgressCallback = (event: ProgressEvent) => void;

export interface TranscriptionEngine {
  readonly kind: EngineKind;
  initialize(): Promise<void>;
  getCapabilities(): Promise<Capabilities>;
  loadModel(modelId: string, onProgress?: ProgressCallback): Promise<void>;
  transcribe(source: File, options: TranscriptionOptions, onProgress: ProgressCallback): Promise<Transcript>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export class TranscriptionCancelled extends Error {
  constructor() {
    super("Transcription cancelled");
    this.name = "TranscriptionCancelled";
  }
}
