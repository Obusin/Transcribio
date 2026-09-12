import { describe, expect, test } from "bun:test";
import type { Segment } from "../engine/types";
import { collapseRepeats, isLikelyHallucination } from "./cleanup";
import { clock, timecode, toSrt, toTxt, toVtt } from "./format";

const seg = (id: number, start: number, end: number, text: string): Segment => ({ id, start, end, text, language: "tl" });

describe("timecodes", () => {
  test("SRT and VTT formats", () => {
    expect(timecode(3723.4567, ",")).toBe("01:02:03,457");
    expect(timecode(0.5)).toBe("00:00:00.500");
    expect(clock(83.9)).toBe("1:23");
    expect(clock(3723)).toBe("1:02:03");
  });
});

describe("exports", () => {
  const segs = [
    seg(0, 0, 2.5, "So basically yung problem natin is the customer can't book"),
    seg(1, 2.4, 5, "kasi walang nagre-reply."),
    seg(2, 5, 5, "Oo."),
  ];

  test("SRT: numbered cues, no overlaps, no zero-length cues", () => {
    const srt = toSrt(segs);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,400\nSo basically yung problem natin");
    expect(srt).toContain("3\n00:00:05,000 --> 00:00:05,500\nOo.");
  });

  test("VTT has a header and dot separators", () => {
    const vtt = toVtt(segs);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:02.400 --> 00:00:05.000");
  });

  test("TXT keeps Taglish exactly as transcribed", () => {
    expect(toTxt(segs)).toBe(
      "[0:00] So basically yung problem natin is the customer can't book\n[0:02] kasi walang nagre-reply.\n[0:05] Oo.",
    );
  });
});

describe("cleanup guards", () => {
  test("collapses repetition loops but keeps natural repetition", () => {
    expect(collapseRepeats("salamat salamat salamat salamat salamat salamat")).toBe("salamat salamat");
    expect(collapseRepeats("salamat, salamat, salamat, salamat.")).toBe("salamat, salamat,");
    expect(collapseRepeats("yeah yeah yeah poetry")).toBe("yeah yeah yeah poetry");
    expect(collapseRepeats("ang ganda ang ganda ang ganda ang ganda talaga")).toBe("ang ganda ang ganda talaga");
  });

  test("flags outro hallucinations, not real speech", () => {
    expect(isLikelyHallucination("Thank you for watching!")).toBe(true);
    expect(isLikelyHallucination("Salamat po sa panonood.")).toBe(true);
    expect(isLikelyHallucination("♪ ♪")).toBe(true);
    expect(isLikelyHallucination("Thank you for coming to the clinic today.")).toBe(false);
    expect(isLikelyHallucination("Oh my god, ate! I wasn't prepared")).toBe(false);
  });
});
