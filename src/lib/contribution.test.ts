import { describe, expect, test } from "bun:test";
import type { StoredTranscript } from "./transcript/store";
import { buildContribution, parseContribution } from "./contribution";

const record = (): StoredTranscript => ({
  id: "rec-1",
  title: "Client call — Dela Cruz",
  fileName: "dela-cruz-consult.mp4",
  fileSize: 123_456_789,
  hasVideo: true,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  edits: { 1: "Nag-increase ang kanyang productivity." },
  raw: {
    segments: [
      { id: 0, start: 0, end: 4.123, text: "Okay so let's start.", language: "tl" },
      { id: 1, start: 4.123, end: 9.5, text: "Nag-e-increase yung kanyang productivity.", language: "tl" },
      { id: 2, start: 9.5, end: 12, text: "Thank you for watching!", language: "tl" },
    ],
    durationSeconds: 12,
    modelId: "whisper-large-v3-turbo",
    engine: "browser-webgpu",
    language: "auto",
    detectedLanguages: ["tl"],
    createdAt: "2026-09-14T00:00:00.000Z",
    stats: { processingSeconds: 3, realtimeFactor: 4.0001 },
  },
});

describe("buildContribution", () => {
  test("pairs what the engine said with what the user corrected it to", () => {
    const c = buildContribution(record(), { rating: 3, errors: ["misheard", "made-up"] });
    expect(c.lines[1]).toEqual({
      start: 4.12,
      end: 9.5,
      raw: "Nag-e-increase yung kanyang productivity.",
      corrected: "Nag-increase ang kanyang productivity.",
      language: "tl",
    });
    expect(c.lines[0].corrected).toBeUndefined();
    expect(c.transcript.correctedCount).toBe(1);
    expect(c.transcript.lineCount).toBe(3);
  });

  test("never carries the file name, title, size, id or anything about the audio file", () => {
    const json = JSON.stringify(buildContribution(record(), { rating: 4, errors: [] }));
    for (const leak of ["dela-cruz-consult", "Dela Cruz", "123456789", "rec-1", "hasVideo", "fileName", "title"]) {
      expect(json).not.toContain(leak);
    }
  });

  test("clamps ratings and drops unknown error kinds", () => {
    // @ts-expect-error — deliberately bad input
    const c = buildContribution(record(), { rating: 9, errors: ["misheard", "misheard", "hacked"] });
    expect(c.rating).toBe(5);
    expect(c.errors).toEqual(["misheard"]);
  });
});

describe("parseContribution (server side)", () => {
  test("round-trips a real contribution", () => {
    const c = buildContribution(record(), { rating: 2, errors: ["translated"], comment: "  lost the Taglish  " });
    expect(parseContribution(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  test("strips fields a caller tries to smuggle in", () => {
    const c = buildContribution(record(), { rating: 2, errors: [] }) as unknown as Record<string, unknown>;
    const tampered = {
      ...c,
      fileName: "secret.mp4",
      audio: "data:audio/wav;base64,AAAA",
      lines: (c.lines as object[]).map((l) => ({ ...l, audio: "AAAA" })),
    };
    const json = JSON.stringify(parseContribution(tampered));
    expect(json).not.toContain("secret.mp4");
    expect(json).not.toContain("AAAA");
  });

  test("rejects malformed bodies", () => {
    expect(parseContribution(null)).toBeNull();
    expect(parseContribution({ rating: 3 })).toBeNull();
    expect(parseContribution({ rating: 3, errors: [], transcript: {}, lines: [{ start: "x" }] })).toBeNull();
  });
});
