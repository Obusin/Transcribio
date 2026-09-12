import type { Transcript } from "../engine/types";

/**
 * Append a continuation run (started at `prev.partial.stoppedAtSeconds`) to a
 * partial transcript.
 *
 * Existing segment ids never change — the user's edits are keyed by them — and
 * new segments are numbered after them. The result is partial again only if
 * the continuation was itself stopped early.
 */
export function appendContinuation(prev: Transcript, next: Transcript): Transcript {
  const cut = prev.partial?.stoppedAtSeconds ?? prev.durationSeconds;
  let id = prev.segments.reduce((m, s) => Math.max(m, s.id), -1) + 1;
  // A continuation starts at `cut`; anything earlier would duplicate existing lines.
  const added = next.segments.filter((s) => s.start >= cut - 0.05).map((s) => ({ ...s, id: id++ }));

  const processingSeconds = prev.stats.processingSeconds + next.stats.processingSeconds;
  const covered = (next.partial?.stoppedAtSeconds ?? next.durationSeconds) || cut;
  const unreadable = [...(prev.unreadable ?? []), ...(next.unreadable ?? [])];
  const { partial: _drop, ...rest } = prev;
  void _drop;

  return {
    ...rest,
    segments: [...prev.segments, ...added],
    durationSeconds: Math.max(prev.durationSeconds, next.durationSeconds),
    detectedLanguages: [...new Set([...prev.detectedLanguages, ...next.detectedLanguages])],
    ...(next.partial ? { partial: next.partial } : {}),
    ...(unreadable.length ? { unreadable } : {}),
    stats: { processingSeconds, realtimeFactor: covered / Math.max(processingSeconds, 1e-3) },
  };
}
