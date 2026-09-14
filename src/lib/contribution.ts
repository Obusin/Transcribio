import type { StoredTranscript } from "./transcript/store";

/**
 * Pilot rating and opt-in transcript sharing.
 *
 * Two levels, and the difference matters for the privacy promise:
 *
 * - A **rating** (stars + which kinds of mistakes) is content-free and goes out
 *   as an ordinary telemetry event.
 * - A **contribution** is the transcript's text and the user's corrections, and
 *   is only ever sent when the user ticks the share box for that transcript.
 *   It never includes audio, video, the file name or the title — lines,
 *   corrections and run details only. The raw-vs-corrected pairs are what make
 *   it useful: they show exactly what the engine got wrong.
 */

export const ERROR_KINDS = [
  { id: "misheard", label: "Misheard words" },
  { id: "translated", label: "Translated to English" },
  { id: "wrong-language", label: "Wrong language" },
  { id: "missing", label: "Missed parts" },
  { id: "made-up", label: "Made-up text" },
  { id: "repeated", label: "Repeated lines" },
  { id: "timestamps", label: "Timestamps off" },
  { id: "other", label: "Something else" },
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number]["id"];

const ERROR_IDS = new Set<string>(ERROR_KINDS.map((e) => e.id));

export function isErrorKind(x: unknown): x is ErrorKind {
  return typeof x === "string" && ERROR_IDS.has(x);
}

export interface ContributionLine {
  start: number;
  end: number;
  /** What the engine produced. */
  raw: string;
  /** The user's correction, when they made one. */
  corrected?: string;
  language: string;
}

export interface Contribution {
  rating: number;
  errors: ErrorKind[];
  comment?: string;
  transcript: {
    durationSeconds: number;
    modelId: string;
    engine: string;
    language: string;
    detectedLanguages: string[];
    realtimeFactor: number;
    partial: boolean;
    lineCount: number;
    correctedCount: number;
  };
  lines: ContributionLine[];
}

/** Upper bound on what one share may carry (a long lecture is ~100 KB of text). */
export const MAX_CONTRIBUTION_BYTES = 2 * 1024 * 1024;

export function buildContribution(
  record: StoredTranscript,
  answers: { rating: number; errors: ErrorKind[]; comment?: string },
): Contribution {
  const lines: ContributionLine[] = record.raw.segments.map((s) => {
    const edit = record.edits[s.id];
    return {
      start: round(s.start),
      end: round(s.end),
      raw: s.text,
      ...(edit != null && edit !== s.text ? { corrected: edit } : {}),
      language: s.language,
    };
  });
  const comment = answers.comment?.trim().slice(0, 2000);
  return {
    rating: clampRating(answers.rating),
    errors: [...new Set(answers.errors.filter(isErrorKind))],
    ...(comment ? { comment } : {}),
    transcript: {
      durationSeconds: round(record.raw.durationSeconds),
      modelId: record.raw.modelId,
      engine: record.raw.engine,
      language: record.raw.language,
      detectedLanguages: record.raw.detectedLanguages,
      realtimeFactor: round(record.raw.stats.realtimeFactor),
      partial: Boolean(record.raw.partial),
      lineCount: lines.length,
      correctedCount: lines.filter((l) => l.corrected != null).length,
    },
    lines,
  };
}

export function clampRating(n: number): number {
  return Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 3)));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Server-side check: accepts only the exact shape above, so nothing else can ride along. */
export function parseContribution(body: unknown): Contribution | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const t = b.transcript as Record<string, unknown> | undefined;
  if (!t || !Array.isArray(b.lines) || !Array.isArray(b.errors) || typeof b.rating !== "number") return null;

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const lines: ContributionLine[] = [];
  for (const raw of b.lines.slice(0, 20_000)) {
    if (typeof raw !== "object" || raw === null) return null;
    const l = raw as Record<string, unknown>;
    const start = num(l.start), end = num(l.end), text = str(l.raw, 2000), language = str(l.language, 12);
    if (start == null || end == null || text == null || language == null) return null;
    const corrected = str(l.corrected, 2000);
    lines.push({ start, end, raw: text, language, ...(corrected != null ? { corrected } : {}) });
  }

  const comment = str(b.comment, 2000);
  return {
    rating: clampRating(b.rating),
    errors: [...new Set(b.errors.filter(isErrorKind))],
    ...(comment ? { comment } : {}),
    transcript: {
      durationSeconds: num(t.durationSeconds) ?? 0,
      modelId: str(t.modelId, 80) ?? "unknown",
      engine: str(t.engine, 40) ?? "unknown",
      language: str(t.language, 12) ?? "unknown",
      detectedLanguages: Array.isArray(t.detectedLanguages)
        ? t.detectedLanguages.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 12))
        : [],
      realtimeFactor: num(t.realtimeFactor) ?? 0,
      partial: t.partial === true,
      lineCount: lines.length,
      correctedCount: lines.filter((l) => l.corrected != null).length,
    },
    lines,
  };
}
