import { describe, expect, test } from "bun:test";
import type { Segment, Transcript } from "../engine/types";
import { combineTranscripts, describeGap, gapBetween, orderForCombine, partAt, recordingTimeFromName, suggestTitle } from "./combine";
import { toTxtWithParts } from "./format";
import type { StoredTranscript } from "./store";

const seg = (id: number, start: number, text: string): Segment => ({ id, start, end: start + 3, text, language: "tl" });
const rec = (over: Partial<StoredTranscript> & { segments: Segment[]; duration: number }): StoredTranscript => {
  const raw: Transcript = {
    segments: over.segments,
    durationSeconds: over.duration,
    modelId: "whisper-large-v3-turbo",
    engine: "browser-webgpu",
    language: "auto",
    detectedLanguages: ["tl"],
    createdAt: "2026-09-10T13:00:00Z",
    stats: { processingSeconds: over.duration / 4, realtimeFactor: 4 },
  };
  return {
    id: over.id ?? crypto.randomUUID(),
    title: over.title ?? "untitled",
    fileName: over.fileName ?? "file.mp4",
    fileSize: 100,
    hasVideo: true,
    createdAt: over.createdAt ?? "2026-09-10T13:00:00Z",
    updatedAt: "2026-09-10T13:00:00Z",
    raw,
    edits: over.edits ?? {},
  };
};

// The two real lecture recordings: 10:45:48 (1 h 24 m 53 s) and 12:11:38.
const partA = rec({ id: "a", title: "2026-09-10 10-45-48", fileName: "2026-09-10 10-45-48.mp4", duration: 5093, segments: [seg(0, 0, "It's a company…"), seg(1, 1705, "Hawthorne effect")], edits: { 1: "Hawthorne Effect [edited]" } });
const partB = rec({ id: "b", title: "2026-09-10 12-11-38", fileName: "2026-09-10 12-11-38.mp4", duration: 3030, segments: [seg(0, 0, "iba-iba tayo types of interviews"), seg(4, 650, "primacy effect")], createdAt: "2026-09-09T00:00:00Z" });

describe("recording time from file names", () => {
  test("OBS and phone patterns; rejects impossible dates", () => {
    expect(recordingTimeFromName("2026-09-10 10-45-48.mp4")).toBe("2026-09-10T10:45:48");
    expect(recordingTimeFromName("VID_20260910_121138.mp4")).toBe("2026-09-10T12:11:38");
    expect(recordingTimeFromName("lecture final.mp4")).toBeNull();
    expect(recordingTimeFromName("2026-13-40 99-99-99.mp4")).toBeNull();
  });
});

describe("ordering and gaps", () => {
  test("orders by recording time even if transcribed in the other order", () => {
    expect(orderForCombine([partB, partA]).map((r) => r.id)).toEqual(["a", "b"]);
  });
  test("the two lecture halves are about a minute apart, same day", () => {
    const g = gapBetween(partA, partB)!;
    expect(g.sameDay).toBe(true);
    expect(Math.round(g.seconds)).toBe(57); // 10:45:48 + 5093 s = 12:10:41 → 12:11:38
    expect(describeGap(g)).toBe("starts 1 min after the previous one ended");
  });
  test("warns about a different day", () => {
    const other = rec({ title: "2026-09-12 09-00-00", fileName: "2026-09-12 09-00-00.mp4", duration: 60, segments: [] });
    expect(describeGap(gapBetween(partB, other)!)).toBe("recorded on a different day");
  });
});

describe("combineTranscripts", () => {
  const c = combineTranscripts([partA, partB], "IO Psych lecture");

  test("one continuous timeline with parts and renumbered ids", () => {
    expect(c.raw.durationSeconds).toBe(5093 + 3030);
    expect(c.parts!.map((p) => p.offsetSeconds)).toEqual([0, 5093]);
    expect(c.raw.segments.map((s) => s.start)).toEqual([0, 1705, 5093, 5093 + 650]);
    expect(c.raw.segments.map((s) => s.id)).toEqual([0, 1, 2, 3]);
  });

  test("keeps raw text and carries edits over to the new ids", () => {
    expect(c.raw.segments[1].text).toBe("Hawthorne effect");
    expect(c.edits).toEqual({ 1: "Hawthorne Effect [edited]" });
  });

  test("does not modify the sources", () => {
    expect(partA.raw.segments[1].start).toBe(1705);
    expect(partB.raw.segments[0].start).toBe(0);
  });

  test("maps a combined time back to its part", () => {
    expect(partAt(c.parts!, 5093 + 650).index).toBe(1);
    expect(partAt(c.parts!, 1705).index).toBe(0);
  });

  test("TXT export restarts timestamps inside each part", () => {
    const txt = toTxtWithParts(c.raw.segments, c.parts!);
    expect(txt).toContain("## Part 1 — 2026-09-10 10-45-48 (1:24:53 · recorded 2026-09-10 10:45:48)");
    expect(txt).toContain("## Part 2 — 2026-09-10 12-11-38");
    expect(txt).toContain("[10:50] primacy effect");
  });

  test("needs at least two", () => {
    expect(() => combineTranscripts([partA], "x")).toThrow();
  });
});

describe("suggestTitle", () => {
  test("uses the shared prefix when meaningful", () => {
    expect(suggestTitle([partA, partB])).toBe("2026-09-10 (combined)");
    expect(suggestTitle([rec({ title: "Meeting", duration: 1, segments: [] }), rec({ title: "Interview", duration: 1, segments: [] })])).toBe("Combined transcript");
  });
});
