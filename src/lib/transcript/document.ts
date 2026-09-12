import { getModel } from "../engine/models";
import { partAt } from "./combine";
import { clock } from "./format";
import { editedSegments, type StoredTranscript } from "./store";

/**
 * A transcript laid out as a document — the single source for the DOCX and
 * PDF exports, so both always contain the same thing. Edits are applied; the
 * raw transcript is untouched.
 */
export interface ExportLine {
  stamp: string;
  speaker?: string;
  /** Set apart in bold before `text` — a glossary term, a question, a list title. */
  lead?: string;
  text: string;
  /** "bullet" marks an item in a list; "quiet" greys the text (an answer). */
  style?: "bullet" | "quiet";
}

export interface ExportDoc {
  title: string;
  facts: { label: string; value: string }[];
  notes: string[];
  sections: { heading?: string; meta?: string; lines: ExportLine[] }[];
  /** Printed in the footer of every page. */
  footer: string;
}

const LANG: Record<string, string> = { en: "English", tl: "Filipino/Taglish" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function modelName(id: string) {
  try {
    return getModel(id).name;
  } catch {
    return id;
  }
}

export function buildExportDoc(record: StoredTranscript): ExportDoc {
  const raw = record.raw;
  const segments = editedSegments(record);
  const parts = record.parts;

  const facts: ExportDoc["facts"] = [
    { label: "Length", value: raw.partial ? `${clock(raw.partial.stoppedAtSeconds)} of ${clock(raw.durationSeconds)}` : clock(raw.durationSeconds) },
    ...(parts ? [{ label: "Parts", value: `${parts.length} recordings` }] : []),
    { label: "Language", value: raw.detectedLanguages.map((l) => LANG[l] ?? l).join(", ") || "—" },
    { label: "Transcribed", value: longDate(record.createdAt) },
    { label: "Model", value: modelName(raw.modelId) },
  ];

  const notes: string[] = [];
  if (raw.partial && !parts) notes.push(`Partial transcript — stopped at ${clock(raw.partial.stoppedAtSeconds)} of ${clock(raw.durationSeconds)}.`);
  if (raw.unreadable?.length) {
    const ranges = raw.unreadable.map((u) => {
      if (!parts) return `${clock(u.start)}–${clock(u.end)}`;
      const { index, part } = partAt(parts, u.start);
      return `part ${index + 1}, ${clock(u.start - part.offsetSeconds)}–${clock(u.end - part.offsetSeconds)}`;
    });
    notes.push(`Damaged audio could not be transcribed at ${ranges.join(", ")}.`);
  }
  if (Object.keys(record.edits).length) notes.push("Includes corrections made after transcription.");

  const line = (s: (typeof segments)[number], offset = 0) => ({
    stamp: clock(s.start - offset),
    ...(s.speaker ? { speaker: s.speaker } : {}),
    text: s.text,
  });

  const sections: ExportDoc["sections"] = parts?.length
    ? parts.map((p, i) => {
        const end = parts[i + 1]?.offsetSeconds ?? Infinity;
        return {
          heading: `Part ${i + 1} — ${p.title}`,
          meta: [clock(p.durationSeconds), p.recordedAt ? `recorded ${p.recordedAt.replace("T", " ")}` : "", p.partial ? "partial" : ""]
            .filter(Boolean)
            .join(" · "),
          lines: segments.filter((s) => s.start >= p.offsetSeconds && s.start < end).map((s) => line(s, p.offsetSeconds)),
        };
      })
    : [{ lines: segments.map((s) => line(s)) }];

  return { title: record.title, facts, notes, sections, footer: `${record.title} · Transcribio` };
}

/** A file name safe on Windows, macOS and Google Drive. */
export function exportFileName(title: string, ext: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "transcript";
  return `${base}.${ext}`;
}
