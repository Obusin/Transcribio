import type { Transcript } from "../engine/types";

/**
 * Local-first transcript storage (IndexedDB) — the browser cache that holds a
 * user's history. Each signed-in account gets its own database on the device,
 * so people sharing a computer never see each other's history. Only
 * transcripts with `savedToAccount` are also copied to the server
 * (see account-sync.ts). The raw ASR transcript is never modified; user edits
 * live in a separate `edits` layer keyed by segment id.
 */

export interface StoredTranscript {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  hasVideo: boolean;
  createdAt: string;
  updatedAt: string;
  raw: Transcript;
  edits: Record<number, string>;
  /**
   * Set when this transcript combines several recordings (see combine.ts).
   * Segment times run on one continuous timeline; each part's offset maps back
   * to its own recording.
   */
  parts?: TranscriptPart[];
  /** The user chose to keep this transcript in their account (not just this browser). */
  savedToAccount?: boolean;
}

export interface TranscriptPart {
  sourceId: string;
  title: string;
  fileName: string;
  /** When the recording was made, if the file name says (e.g. OBS "2026-09-10 10-45-48"). */
  recordedAt: string | null;
  offsetSeconds: number;
  durationSeconds: number;
  /** The source transcript stopped early, so this part doesn't cover its whole recording. */
  partial?: boolean;
}

/** The pre-accounts database, migrated into the first account that signs in. */
const LEGACY_DB = "transcribio";
const STORE = "transcripts";
let dbName = LEGACY_DB;

/** Point the cache at this account's database. Call before any read or write. */
export function selectAccountCache(userId: string) {
  dbName = `transcribio-${userId}`;
}

function open(name = dbName): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, name = dbName): Promise<T> {
  const db = await open(name);
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export const transcripts = {
  put: (t: StoredTranscript) => tx("readwrite", (s) => s.put(t)),
  get: (id: string) => tx<StoredTranscript | undefined>("readonly", (s) => s.get(id)),
  delete: (id: string) => tx("readwrite", (s) => s.delete(id)),
  async list(): Promise<StoredTranscript[]> {
    const all = await tx<StoredTranscript[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};

/**
 * Move history created before accounts existed into the current account, once.
 * Returns how many transcripts moved.
 */
export async function adoptLegacyHistory(): Promise<number> {
  if (dbName === LEGACY_DB || typeof indexedDB.databases !== "function") return 0;
  const exists = (await indexedDB.databases()).some((d) => d.name === LEGACY_DB);
  if (!exists) return 0;
  const legacy = await tx<StoredTranscript[]>("readonly", (s) => s.getAll(), LEGACY_DB).catch(() => []);
  for (const t of legacy) await transcripts.put(t);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return legacy.length;
}

/** Remove this account's cached history from this device. */
export function clearAccountCache(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Segments with the user's edits applied — what the editor shows and exports. */
export function editedSegments(t: Pick<StoredTranscript, "raw" | "edits">) {
  return t.raw.segments.map((s) => (t.edits[s.id] != null ? { ...s, text: t.edits[s.id] } : s));
}
