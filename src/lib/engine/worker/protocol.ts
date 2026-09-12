import type { ModelVariant } from "../models";
import type { EngineKind, ProgressEvent, Transcript, TranscriptionOptions } from "../types";

export type WorkerRequest =
  | {
      type: "load";
      modelId: string;
      variant: ModelVariant;
      /** ONNX Runtime WASM threads. Fixed once the runtime initializes; changing it needs a new worker. */
      threads: number;
    }
  | {
      type: "transcribe";
      engine: EngineKind;
      options: TranscriptionOptions;
      durationSeconds: number;
      /** Share of wall time the GPU may be busy (see resources.ts). */
      gpuDuty: number;
      /** Start this many seconds into the media (continuing a partial transcript). */
      startAt?: number;
      /** Streamed from disk inside the worker (File is passed by reference, not copied). */
      file?: File;
      /** Pre-decoded 16 kHz PCM, used only when the browser can't demux/decode the file itself. */
      pcm?: Float32Array;
    }
  | { type: "set-duty"; gpuDuty: number }
  | {
      type: "cancel";
      /** Return the segments transcribed so far (as a partial transcript) instead of discarding them. */
      keepPartial?: boolean;
    }
  | { type: "pause" }
  | { type: "resume" };

export type WorkerResponse =
  | { type: "loaded" }
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; transcript: Transcript }
  | { type: "cancelled" }
  | { type: "needs-pcm"; reason: string }
  | { type: "error"; name: string; message: string };
