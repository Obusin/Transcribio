import { describe, expect, test } from "bun:test";
import type { Segment, Transcript } from "../engine/types";
import { appendContinuation } from "./merge";

const seg = (id: number, start: number, text: string): Segment => ({ id, start, end: start + 2, text, language: "tl" });
const transcript = (over: Partial<Transcript>): Transcript => ({
  segments: [],
  durationSeconds: 600,
  modelId: "whisper-large-v3-turbo",
  engine: "browser-webgpu",
  language: "auto",
  detectedLanguages: ["tl"],
  createdAt: "2026-09-11T00:00:00Z",
  stats: { processingSeconds: 30, realtimeFactor: 4 },
  ...over,
});

describe("appendContinuation", () => {
  const prev = transcript({
    segments: [seg(0, 0, "Kumusta"), seg(1, 60, "Sige po"), seg(3, 118, "edited later")], // ids need not be contiguous
    partial: { stoppedAtSeconds: 120 },
  });

  test("appends new lines after the stop point with fresh ids; existing ids untouched", () => {
    const next = transcript({ segments: [seg(0, 121, "Tuloy tayo"), seg(1, 300, "Salamat")], stats: { processingSeconds: 90, realtimeFactor: 5.3 } });
    const out = appendContinuation(prev, next);
    expect(out.segments.map((s) => s.id)).toEqual([0, 1, 3, 4, 5]);
    expect(out.segments.map((s) => s.text)).toEqual(["Kumusta", "Sige po", "edited later", "Tuloy tayo", "Salamat"]);
    expect(out.partial).toBeUndefined();
    expect(out.stats.processingSeconds).toBe(120);
  });

  test("drops anything before the stop point (no duplicated lines at the seam)", () => {
    const next = transcript({ segments: [seg(0, 100, "duplicate"), seg(1, 130, "new")] });
    expect(appendContinuation(prev, next).segments.map((s) => s.text)).toEqual(["Kumusta", "Sige po", "edited later", "new"]);
  });

  test("stays partial if the continuation was also stopped early", () => {
    const next = transcript({ segments: [seg(0, 125, "a")], partial: { stoppedAtSeconds: 240 } });
    expect(appendContinuation(prev, next).partial).toEqual({ stoppedAtSeconds: 240 });
  });

  test("keeps unreadable ranges from both runs", () => {
    const out = appendContinuation(
      transcript({ ...prev, unreadable: [{ start: 10, end: 12 }] }),
      transcript({ segments: [], unreadable: [{ start: 400, end: 410 }] }),
    );
    expect(out.unreadable).toEqual([
      { start: 10, end: 12 },
      { start: 400, end: 410 },
    ]);
  });
});
