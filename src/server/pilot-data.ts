import "server-only";
import { get, list } from "@vercel/blob";
import type { Contribution } from "@/lib/contribution";

/**
 * Reads pilot data back out of the private Blob store for the admin page.
 *
 * Reading costs quota on the free plan too: every list() is one of the ~2,000
 * monthly "advanced operations", so results are cached in memory for a few
 * minutes (add &refresh=1 to force). Individual reads use the Blob cache — the
 * files never change — so repeat reads are cache hits and cost nothing.
 */

export interface PilotEvent {
  name: string;
  props: Record<string, unknown>;
  device: string;
  ua?: string;
  at: string;
}

export type SharedTranscript = Contribution & { at: string; device: string; pilot?: string; ua?: string };

export interface PilotData {
  events: PilotEvent[];
  shared: SharedTranscript[];
  /** Blob writes (event batches + shares) so far this calendar month — the free plan allows ~2,000. */
  writesThisMonth: number;
  loadedAt: string;
}

const TTL_MS = 5 * 60_000;
let cached: PilotData | null = null;
let cachedAt = 0;

async function listAll(prefix: string) {
  const all: { pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    all.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && all.length < 10_000);
  return all.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
}

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const found = await get(pathname, { access: "private" });
    return found ? ((await new Response(found.stream).json()) as T) : null;
  } catch {
    return null;
  }
}

/** Accepts both shapes: batches ({device, ua, events}) and the older one-event files. */
function flatten(file: unknown): PilotEvent[] {
  if (!file || typeof file !== "object") return [];
  const f = file as { device?: string; ua?: string; events?: { name: string; props: Record<string, unknown>; at: string }[] } & Partial<PilotEvent>;
  if (Array.isArray(f.events)) return f.events.map((e) => ({ ...e, device: f.device ?? "unknown", ua: f.ua }));
  return f.name ? [{ name: f.name, props: f.props ?? {}, device: f.device ?? "unknown", ua: f.ua, at: f.at ?? "" }] : [];
}

export async function loadPilotData(opts: { refresh?: boolean; maxEventFiles?: number } = {}): Promise<PilotData> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { events: [], shared: [], writesThisMonth: 0, loadedAt: new Date().toISOString() };
  if (!opts.refresh && cached && Date.now() - cachedAt < TTL_MS) return cached;

  const [eventFiles, sharedFiles] = await Promise.all([listAll("events/"), listAll("contributions/")]);
  const month = new Date().toISOString().slice(0, 7);
  const writesThisMonth = [...eventFiles, ...sharedFiles].filter((b) => b.pathname.split("/")[1]?.startsWith(month)).length;

  const [eventJson, shared] = await Promise.all([
    Promise.all(eventFiles.slice(0, opts.maxEventFiles ?? 4000).map((b) => readJson<unknown>(b.pathname))),
    Promise.all(sharedFiles.slice(0, 200).map((b) => readJson<SharedTranscript>(b.pathname))),
  ]);

  const events = eventJson.flatMap(flatten).sort((a, b) => (a.at < b.at ? 1 : -1));
  cached = {
    events,
    shared: shared.filter((s): s is SharedTranscript => s !== null),
    writesThisMonth,
    loadedAt: new Date().toISOString(),
  };
  cachedAt = Date.now();
  return cached;
}

export function browserLabel(ua: string | undefined): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /OPR\//.test(ua) ? "Opera" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  return os ? `${br} · ${os}` : br;
}
