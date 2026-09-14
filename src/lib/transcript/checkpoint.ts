import type { EngineKind, LanguageChoice, Segment, Transcript } from "../engine/types";
import { appendContinuation } from "./merge";
import type { StoredTranscript } from "./store";

/**
 * Builds the partial transcript a running job saves every so often, so a tab
 * crash leaves something the Continue flow can resume.
 *
 * Returns null when there is nothing worth saving yet.
 */
export function buildCheckpoint(o: {
  done: Segment[];
  processedSeconds: number;
  startAt: number;
  jobId: string;
  jobCreatedAt: string;
  now: string;
  elapsedSeconds: number;
  durationSeconds: number;
  modelId: string;
  engine: EngineKind;
  language: LanguageChoice;
  file: { name: string; size: number; hasVideo: boolean };
  continueFrom?: StoredTranscript;
}): StoredTranscript | null {
  if (!o.done.length) return null;
  // Stop at the last segment actually held: if a chunk's progress event arrived
  // before its lines, resuming from `processedSeconds` would skip those lines.
  const stoppedAtSeconds = Math.min(o.processedSeconds, o.done[o.done.length - 1].end);
  if (stoppedAtSeconds <= o.startAt) return null;

  const segments = o.done.filter((sg) => sg.end <= stoppedAtSeconds + 0.05);
  const raw: Transcript = {
    segments,
    durationSeconds: o.durationSeconds,
    modelId: o.modelId,
    engine: o.engine,
    language: o.language,
    detectedLanguages: [...new Set(segments.map((sg) => sg.language).filter(Boolean))],
    createdAt: o.jobCreatedAt,
    partial: { stoppedAtSeconds },
    stats: {
      processingSeconds: o.elapsedSeconds,
      realtimeFactor: (stoppedAtSeconds - o.startAt) / Math.max(o.elapsedSeconds, 1e-3),
    },
  };

  if (o.continueFrom) return { ...o.continueFrom, raw: appendContinuation(o.continueFrom.raw, raw), updatedAt: o.now };

  return {
    id: o.jobId,
    title: o.file.name.replace(/\.[^.]+$/, ""),
    fileName: o.file.name,
    fileSize: o.file.size,
    hasVideo: o.file.hasVideo,
    createdAt: o.jobCreatedAt,
    updatedAt: o.now,
    raw,
    edits: {},
  };
}
