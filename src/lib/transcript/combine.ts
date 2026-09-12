import type { Segment } from "../engine/types";
import type { StoredTranscript, TranscriptPart } from "./store";

/**
 * Combine several transcripts (e.g. one lecture recorded in two files) into a
 * single transcript with parts.
 *
 * Segments are placed on one continuous timeline — each part starts where the
 * previous recording ended — and renumbered; the originals' raw text is kept
 * and their edits carry over. The source transcripts are not modified.
 */

/** Recording time from common file-name patterns, as a local ISO string, or null. */
export function recordingTimeFromName(name: string): string | null {
  const patterns = [
    /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[-.:](\d{2})[-.:](\d{2})/, // OBS: 2026-09-10 10-45-48
    /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, // phones: VID_20260910_104548
  ];
  for (const rx of patterns) {
    const m = name.match(rx);
    if (!m) continue;
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d, h, mi, s);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59 || s > 59) continue;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  return null;
}

function recordedAt(r: StoredTranscript): string | null {
  return recordingTimeFromName(r.fileName) ?? recordingTimeFromName(r.title);
}

/** Order for combining: by recording time from the file name, else by when it was transcribed. */
export function orderForCombine(records: StoredTranscript[]): StoredTranscript[] {
  return [...records].sort((a, b) => {
    const ta = recordedAt(a);
    const tb = recordedAt(b);
    if (ta && tb) return ta.localeCompare(tb);
    if (ta) return -1;
    if (tb) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface Gap {
  /** Seconds between the end of the previous recording and the start of this one. */
  seconds: number;
  sameDay: boolean;
}

/** The pause between two consecutive recordings, when both file names carry a time. */
export function gapBetween(prev: StoredTranscript, next: StoredTranscript): Gap | null {
  const a = recordedAt(prev);
  const b = recordedAt(next);
  if (!a || !b) return null;
  const prevEnd = new Date(a).getTime() + prev.raw.durationSeconds * 1000;
  return { seconds: (new Date(b).getTime() - prevEnd) / 1000, sameDay: a.slice(0, 10) === b.slice(0, 10) };
}

export function describeGap(g: Gap): string {
  if (!g.sameDay) return "recorded on a different day";
  if (g.seconds < 0) return "overlaps the previous recording";
  const m = Math.round(g.seconds / 60);
  if (m < 1) return "starts right after the previous one";
  if (m < 60) return `starts ${m} min after the previous one ended`;
  return `starts ${Math.floor(m / 60)} h ${m % 60} min after the previous one ended`;
}

export function combineTranscripts(ordered: StoredTranscript[], title: string, now = new Date()): StoredTranscript {
  if (ordered.length < 2) throw new Error("Choose at least two transcripts to combine.");
  const segments: Segment[] = [];
  const edits: Record<number, string> = {};
  const parts: TranscriptPart[] = [];
  const unreadable: { start: number; end: number }[] = [];
  let offset = 0;
  let processing = 0;
  let nextId = 0;

  for (const r of ordered) {
    const raw = r.raw;
    parts.push({
      sourceId: r.id,
      title: r.title,
      fileName: r.fileName,
      recordedAt: recordedAt(r),
      offsetSeconds: offset,
      durationSeconds: raw.durationSeconds,
      ...(raw.partial ? { partial: true } : {}),
    });
    for (const s of raw.segments) {
      const id = nextId++;
      segments.push({ ...s, id, start: s.start + offset, end: s.end + offset });
      if (r.edits[s.id] != null) edits[id] = r.edits[s.id];
    }
    for (const u of raw.unreadable ?? []) unreadable.push({ start: u.start + offset, end: u.end + offset });
    processing += raw.stats.processingSeconds;
    offset += raw.durationSeconds;
  }

  const first = ordered[0].raw;
  const iso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    fileName: `${ordered.length} recordings`,
    fileSize: ordered.reduce((n, r) => n + r.fileSize, 0),
    hasVideo: false,
    createdAt: iso,
    updatedAt: iso,
    parts,
    edits,
    raw: {
      segments,
      durationSeconds: offset,
      modelId: first.modelId,
      engine: first.engine,
      language: first.language,
      detectedLanguages: [...new Set(ordered.flatMap((r) => r.raw.detectedLanguages))],
      createdAt: iso,
      ...(unreadable.length ? { unreadable } : {}),
      stats: { processingSeconds: processing, realtimeFactor: offset / Math.max(processing, 1e-3) },
    },
  };
}

/** Which part a moment on the combined timeline belongs to. */
export function partAt(parts: TranscriptPart[], seconds: number): { index: number; part: TranscriptPart } {
  let index = 0;
  for (let i = 0; i < parts.length; i++) if (seconds >= parts[i].offsetSeconds) index = i;
  return { index, part: parts[index] };
}

/** A default title: the shared start of the part titles, else "Combined transcript". */
export function suggestTitle(ordered: StoredTranscript[]): string {
  const titles = ordered.map((r) => r.title);
  let prefix = titles[0];
  for (const t of titles.slice(1)) while (prefix && !t.startsWith(prefix)) prefix = prefix.slice(0, -1);
  // Don't cut a word or number in half ("2026-09-10 1…"): end at a separator.
  if (titles.some((t) => t.length > prefix.length && /[\p{L}\p{N}]/u.test(t[prefix.length]))) {
    prefix = prefix.replace(/[\p{L}\p{N}]+$/u, "");
  }
  prefix = prefix.replace(/[\s\-_–—:·]+$/, "").trim();
  return prefix.length >= 4 ? `${prefix} (combined)` : "Combined transcript";
}
