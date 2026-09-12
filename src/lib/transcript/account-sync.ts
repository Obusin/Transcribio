import { ACCOUNTS_ENABLED } from "../deployment";
import { transcripts, type StoredTranscript } from "./store";

/**
 * Keeps the browser cache and the account in step — but only for transcripts
 * the user chose to save. Everything else never leaves the device.
 *
 * Conflict rule: last write wins, by `updatedAt`.
 */

export interface SavedSummary {
  id: string;
  title: string;
  durationSeconds: number;
  parts: number;
  createdAt: string;
  updatedAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

export const account = {
  list: () => api<{ items: SavedSummary[] }>("/api/saved").then((r) => r.items),
  get: (id: string) => api<{ record: StoredTranscript }>(`/api/saved/${encodeURIComponent(id)}`).then((r) => r.record),
  save: (t: StoredTranscript) => api(`/api/saved/${encodeURIComponent(t.id)}`, { method: "PUT", body: JSON.stringify(t) }),
  remove: (id: string) => api(`/api/saved/${encodeURIComponent(id)}`, { method: "DELETE" }),
  signOut: () => api("/api/auth/sign-out", { method: "POST" }),
};

/** Save to the browser cache, and to the account too if the user chose to. */
export async function persist(t: StoredTranscript): Promise<{ synced: boolean; error?: string }> {
  await transcripts.put(t);
  // No accounts on this deployment: the browser cache is the only home.
  if (!ACCOUNTS_ENABLED || !t.savedToAccount) return { synced: false };
  try {
    await account.save(t);
    return { synced: true };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Bring saved transcripts onto this device (e.g. signed in on a new computer,
 * or after clearing the browser) and push local changes the account missed.
 * Returns how many transcripts were downloaded.
 */
export async function syncWithAccount(): Promise<number> {
  if (!ACCOUNTS_ENABLED) return 0;
  const [remote, local] = await Promise.all([account.list(), transcripts.list()]);
  const localById = new Map(local.map((t) => [t.id, t]));
  let downloaded = 0;
  for (const r of remote) {
    const mine = localById.get(r.id);
    if (!mine || r.updatedAt > mine.updatedAt) {
      const record = await account.get(r.id);
      await transcripts.put({ ...record, savedToAccount: true });
      if (!mine) downloaded++;
    }
  }
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  for (const t of local) {
    if (!t.savedToAccount) continue;
    const r = remoteById.get(t.id);
    if (!r || t.updatedAt > r.updatedAt) await account.save(t).catch(() => {});
  }
  return downloaded;
}
