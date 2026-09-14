import { put } from "@vercel/blob";
import { loadPilotData } from "@/server/pilot-data";
import { fail, json, sameOrigin } from "@/server/http";

/**
 * Pilot telemetry collector.
 *
 * POST — one event, written as its own small blob. One object per event keeps
 * writes atomic without a database; volume for a hand-picked pilot is tiny.
 *
 * GET — read them back, gated by ADMIN_TOKEN. This is how Mark reads the pilot
 * without a dashboard.
 *
 * Content is never accepted here: the allow-list below drops anything that is
 * not one of the known numeric/short fields, so a future caller cannot start
 * posting transcript text by accident.
 */

const EVENTS = new Set([
  "app_opened",
  "file_selected",
  "transcribe_started",
  "transcribe_finished",
  "transcribe_failed",
  "transcribe_cancelled",
  "transcribe_crashed",
  "reviewer_opened",
  "ai_reviewer_used",
  "exported",
  "link_imported",
  "transcript_rated",
  "model_loaded",
  "model_load_failed",
  "feedback",
]);

const NUMBERS = new Set(["durationSeconds", "realtimeFactor", "rating", "processedSeconds", "minutesRunning", "loadSeconds"]);
const STRINGS = new Set(["deviceTier", "profile", "modelId", "language", "format", "error", "pilot", "source", "errors", "ref"]);
const BOOLS = new Set(["webgpu", "shared"]);

/** Only known keys survive, and only at a sane size. */
function cleanProps(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (NUMBERS.has(k) && typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (BOOLS.has(k) && typeof v === "boolean") out[k] = v;
    else if (STRINGS.has(k) && typeof v === "string") out[k] = v.slice(0, 200);
    // `message` is the one free-text field, and only on feedback the user typed.
    else if (k === "message" && typeof v === "string") out[k] = v.slice(0, 2000);
  }
  return out;
}

const MAX_BATCH = 40;

type RawEvent = { name?: unknown; props?: unknown; at?: unknown };

function cleanEvent(e: RawEvent) {
  if (typeof e?.name !== "string" || !EVENTS.has(e.name)) return null;
  const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : new Date().toISOString();
  return { name: e.name, props: cleanProps(e.props), at };
}

/**
 * One write per batch, not per event: the free Blob plan allows ~2,000 writes a
 * month. Accepts a batch ({ device, ua, events: [...] }) or, for older clients
 * still open in someone's tab, a single event.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("This request came from another site and was blocked.", 403);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ ok: true, stored: false });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; props?: unknown; at?: unknown; events?: unknown; device?: unknown; ua?: unknown }
    | null;
  if (!body) return fail("Expected JSON.", 400);

  const raw: RawEvent[] = Array.isArray(body.events) ? (body.events as RawEvent[]).slice(0, MAX_BATCH) : [body];
  const events = raw.map(cleanEvent).filter((e) => e !== null);
  if (!events.length) return fail("Unknown event.", 400);

  const batch = {
    device: typeof body.device === "string" ? body.device.slice(0, 64) : "unknown",
    ua: typeof body.ua === "string" ? body.ua.slice(0, 200) : (req.headers.get("user-agent") ?? "").slice(0, 200),
    at: new Date().toISOString(),
    events,
  };

  try {
    await put(`events/${batch.at.slice(0, 10)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(batch), {
      // The store is private: tester data must never sit at a guessable public URL.
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
  } catch (err) {
    // A telemetry failure must never look like an app failure to the caller.
    console.error("telemetry write failed", err);
    return json({ ok: true, stored: false });
  }
  return json({ ok: true, stored: true, count: events.length });
}

/** GET ?token=ADMIN_TOKEN → the raw events, newest first (same cached loader as /admin). */
export async function GET(req: Request) {
  const admin = process.env.ADMIN_TOKEN;
  const url = new URL(req.url);
  if (!admin || url.searchParams.get("token") !== admin) return fail("Not found.", 404);
  const data = await loadPilotData({ refresh: url.searchParams.has("refresh") });
  return json({ count: data.events.length, writesThisMonth: data.writesThisMonth, events: data.events.slice(0, 1000) });
}
