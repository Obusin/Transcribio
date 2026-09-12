import type { Segment } from "../engine/types";
import type { TranscriptPart } from "./store";

/** 83.456 → "00:01:23,456" (SRT) or "00:01:23.456" (VTT). */
export function timecode(seconds: number, sep: "," | "." = "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${String(r).padStart(3, "0")}`;
}

/** 83.4 → "1:23", 3723 → "1:02:03" — for display. */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function label(seg: Segment) {
  return seg.speaker ? `${seg.speaker}: ` : "";
}

export function toTxt(segments: Segment[], { timestamps = true } = {}): string {
  return segments
    .map((s) => (timestamps ? `[${clock(s.start)}] ${label(s)}${s.text}` : `${label(s)}${s.text}`))
    .join("\n");
}

/** Subtitle cues shouldn't overlap or be zero-length; players handle both badly. */
function cues(segments: Segment[]) {
  return segments.map((s, i) => {
    const next = segments[i + 1];
    let end = Math.max(s.end, s.start + 0.5);
    if (next && end > next.start) end = Math.max(s.start + 0.1, next.start);
    return { start: s.start, end, text: `${label(s)}${s.text}` };
  });
}

export function toSrt(segments: Segment[]): string {
  return cues(segments)
    .map((c, i) => `${i + 1}\n${timecode(c.start, ",")} --> ${timecode(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

export function toVtt(segments: Segment[]): string {
  const body = cues(segments)
    .map((c) => `${timecode(c.start)} --> ${timecode(c.end)}\n${c.text.replace(/-->/g, "→")}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export type ExportFormat = "txt" | "srt" | "vtt";

/**
 * A combined transcript as text: a heading per part, timestamps restarting
 * inside each part so they match that recording.
 */
export function toTxtWithParts(segments: Segment[], parts: TranscriptPart[]): string {
  return parts
    .map((p, i) => {
      const end = parts[i + 1]?.offsetSeconds ?? Infinity;
      const lines = segments
        .filter((s) => s.start >= p.offsetSeconds && s.start < end)
        .map((s) => ({ ...s, start: s.start - p.offsetSeconds, end: s.end - p.offsetSeconds }));
      const when = p.recordedAt ? ` · recorded ${p.recordedAt.replace("T", " ")}` : "";
      return `## Part ${i + 1} — ${p.title} (${clock(p.durationSeconds)}${when})\n\n${toTxt(lines)}`;
    })
    .join("\n\n");
}

/** SRT/VTT of a combined transcript use its continuous timeline (as if the recordings were joined). */
export function exportTranscript(
  segments: Segment[],
  format: ExportFormat,
  parts?: TranscriptPart[],
): { body: string; mime: string } {
  switch (format) {
    case "txt":
      return { body: parts?.length ? toTxtWithParts(segments, parts) : toTxt(segments), mime: "text/plain" };
    case "srt":
      return { body: toSrt(segments), mime: "application/x-subrip" };
    case "vtt":
      return { body: toVtt(segments), mime: "text/vtt" };
  }
}
