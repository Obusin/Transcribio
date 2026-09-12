import "server-only";
import { db } from "./db";

/**
 * Transcripts a user explicitly saved to their account. Every query is scoped
 * by user_id, so one account can never read or change another's rows.
 */

export interface SavedSummary {
  id: string;
  title: string;
  durationSeconds: number;
  parts: number;
  createdAt: string;
  updatedAt: string;
}

export const MAX_RECORD_BYTES = 8 * 1024 * 1024;

export function listSaved(userId: string): SavedSummary[] {
  return (
    db()
      .prepare(
        "SELECT id, title, duration_seconds, parts, created_at, updated_at FROM saved_transcripts WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId) as { id: string; title: string; duration_seconds: number; parts: number; created_at: string; updated_at: string }[]
  ).map((r) => ({ id: r.id, title: r.title, durationSeconds: r.duration_seconds, parts: r.parts, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function getSaved(userId: string, id: string): unknown | null {
  const row = db().prepare("SELECT record_json FROM saved_transcripts WHERE user_id = ? AND id = ?").get(userId, id) as
    | { record_json: string }
    | undefined;
  return row ? JSON.parse(row.record_json) : null;
}

/** Validates the shape we rely on; the rest of the record is stored as-is. */
export function parseRecord(id: string, body: unknown) {
  const r = body as {
    id?: unknown; title?: unknown; createdAt?: unknown; updatedAt?: unknown;
    raw?: { durationSeconds?: unknown; segments?: unknown }; parts?: unknown;
  };
  if (!r || typeof r !== "object" || r.id !== id) throw new Error("The transcript id doesn't match the address.");
  if (typeof r.title !== "string" || r.title.length > 300) throw new Error("A transcript needs a title under 300 characters.");
  if (!r.raw || typeof r.raw.durationSeconds !== "number" || !Array.isArray(r.raw.segments)) throw new Error("This isn't a transcript.");
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") throw new Error("Missing dates.");
  return {
    title: r.title,
    durationSeconds: r.raw.durationSeconds,
    parts: Array.isArray(r.parts) ? r.parts.length : 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function upsertSaved(userId: string, id: string, body: unknown, json: string) {
  const meta = parseRecord(id, body);
  db()
    .prepare(
      `INSERT INTO saved_transcripts (id, user_id, title, duration_seconds, parts, record_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET title = excluded.title, duration_seconds = excluded.duration_seconds,
         parts = excluded.parts, record_json = excluded.record_json, updated_at = excluded.updated_at`,
    )
    .run(id, userId, meta.title, meta.durationSeconds, meta.parts, json, meta.createdAt, meta.updatedAt);
}

export function deleteSaved(userId: string, id: string): boolean {
  return db().prepare("DELETE FROM saved_transcripts WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
}
