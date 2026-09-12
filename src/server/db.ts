import "server-only";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The app's own database: a single SQLite file on the machine running the app
 * (default `data/transcribio.db`). Holds accounts, sessions, and only the
 * transcripts a user chose to save to their account. Everything else stays in
 * the browser.
 *
 * All queries live in src/server/*.ts, so moving to Postgres later means
 * rewriting those modules, not the app.
 */

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    sends_in_window INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS saved_transcripts (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    parts INTEGER NOT NULL DEFAULT 0,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
`;

const globalForDb = globalThis as unknown as { __transcribioDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.__transcribioDb) {
    const file = process.env.TRANSCRIBIO_DB ?? join(process.cwd(), "data", "transcribio.db");
    mkdirSync(dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec(SCHEMA);
    globalForDb.__transcribioDb = d;
  }
  return globalForDb.__transcribioDb;
}

/**
 * Secret used to hash login codes. AUTH_SECRET wins; otherwise one is generated
 * on first run and kept in the database, so local setups need no configuration.
 */
export function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const d = db();
  const row = d.prepare("SELECT value FROM meta WHERE key = 'auth_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString("base64url");
  d.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('auth_secret', ?)").run(secret);
  return (d.prepare("SELECT value FROM meta WHERE key = 'auth_secret'").get() as { value: string }).value;
}
