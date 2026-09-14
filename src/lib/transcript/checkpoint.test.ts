import { describe, expect, test } from "bun:test";
import type { Segment, Transcript } from "../engine/types";
import { buildCheckpoint } from "./checkpoint";
import { appendContinuation } from "./merge";

const seg = (id: number, start: number, end: number, text = `line ${id}`): Segment => ({ id, start, end, text, language: "tl" });

const base = {
  startAt: 0,
  jobId: "job-1",
  jobCreatedAt: "2026-09-14T00:00:00.000Z",
  now: "2026-09-14T00:05:00.000Z",
  elapsedSeconds: 300,
  durationSeconds: 5094,
  modelId: "whisper-large-v3-turbo",
  engine: "browser-webgpu" as const,
  language: "auto" as const,
  file: { name: "meeting.mp4", size: 1000, hasVideo: true },
};

describe("buildCheckpoint", () => {
  test("nothing to save before the first line", () => {
    expect(buildCheckpoint({ ...base, done: [], processedSeconds: 30 })).toBeNull();
  });

  test("a fresh job saves a partial record under the job id", () => {
    const r = buildCheckpoint({ ...base, done: [seg(0, 0, 10), seg(1, 10, 20)], processedSeconds: 20 })!;
    expect(r.id).toBe("job-1");
    expect(r.title).toBe("meeting");
    expect(r.raw.partial).toEqual({ stoppedAtSeconds: 20 });
    expect(r.raw.segments).toHaveLength(2);
    expect(r.raw.detectedLanguages).toEqual(["tl"]);
  });

  test("progress ahead of the lines never skips them: it stops at the last line held", () => {
    // Engine reported 60s processed, but lines for 20–60s haven't arrived yet.
    const r = buildCheckpoint({ ...base, done: [seg(0, 0, 10), seg(1, 10, 20)], processedSeconds: 60 })!;
    expect(r.raw.partial?.stoppedAtSeconds).toBe(20);
  });

  test("resuming a crash checkpoint gives every line exactly once", () => {
    const checkpoint = buildCheckpoint({ ...base, done: [seg(0, 0, 10), seg(1, 10, 20)], processedSeconds: 20 })!;

    // Continue re-runs from stoppedAtSeconds; the engine may repeat a boundary line.
    const rest: Transcript = {
      ...checkpoint.raw,
      partial: undefined,
      segments: [seg(0, 10, 20, "line 1"), seg(1, 20, 30, "line 2"), seg(2, 30, 40, "line 3")],
      durationSeconds: 5094,
    };
    const merged = appendContinuation(checkpoint.raw, rest);
    expect(merged.segments.map((s) => s.text)).toEqual(["line 0", "line 1", "line 2", "line 3"]);
    expect(merged.partial).toBeUndefined();
    expect(new Set(merged.segments.map((s) => s.id)).size).toBe(merged.segments.length);
  });

  test("checkpointing a continuation extends the existing transcript, keeping its identity", () => {
    const first = buildCheckpoint({ ...base, done: [seg(0, 0, 10), seg(1, 10, 20)], processedSeconds: 20 })!;
    const again = buildCheckpoint({
      ...base,
      jobId: "ignored-for-continuations",
      startAt: 20,
      continueFrom: first,
      done: [seg(0, 20, 30), seg(1, 30, 40)],
      processedSeconds: 40,
    })!;
    expect(again.id).toBe("job-1");
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.raw.partial?.stoppedAtSeconds).toBe(40);
    expect(again.raw.segments.map((s) => s.start)).toEqual([0, 10, 20, 30]);
  });

  test("a continuation with no new progress saves nothing", () => {
    const first = buildCheckpoint({ ...base, done: [seg(0, 0, 10)], processedSeconds: 10 })!;
    expect(
      buildCheckpoint({ ...base, startAt: 10, continueFrom: first, done: [seg(0, 5, 10)], processedSeconds: 10 }),
    ).toBeNull();
  });
});
