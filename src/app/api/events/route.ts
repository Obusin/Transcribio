import { get, list, put } from "@vercel/blob";
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
  "feedback",
]);

const NUMBERS = new Set(["durationSeconds", "realtimeFactor", "rating", "processedSeconds", "minutesRunning"]);
const STRINGS = new Set(["deviceTier", "profile", "modelId", "language", "format", "error", "pilot", "source"]);
const BOOLS = new Set(["webgpu"]);

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

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("This request came from another site and was blocked.", 403);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ ok: true, stored: false });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; props?: unknown; device?: unknown; at?: unknown; ua?: unknown }
    | null;
  if (!body || typeof body.name !== "string" || !EVENTS.has(body.name)) return fail("Unknown event.", 400);

  const event = {
    name: body.name,
    props: cleanProps(body.props),
    device: typeof body.device === "string" ? body.device.slice(0, 64) : "unknown",
    ua: typeof body.ua === "string" ? body.ua.slice(0, 200) : "",
    at: new Date().toISOString(),
  };

  const day = event.at.slice(0, 10);
  try {
    await put(`events/${day}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(event), {
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
  return json({ ok: true, stored: true });
}

/** GET ?token=ADMIN_TOKEN[&day=YYYY-MM-DD] → the raw events, newest first. */
export async function GET(req: Request) {
  const admin = process.env.ADMIN_TOKEN;
  const url = new URL(req.url);
  if (!admin || url.searchParams.get("token") !== admin) return fail("Not found.", 404);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ events: [], note: "No blob store configured." });

  const day = url.searchParams.get("day");
  const { blobs } = await list({ prefix: day ? `events/${day}/` : "events/", limit: 1000 });
  const newest = blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)).slice(0, 500);

  const events = await Promise.all(
    newest.map(async (b) => {
      try {
        // Private blobs aren't readable by URL; read them through the SDK with the store token.
        const found = await get(b.pathname, { access: "private", useCache: false });
        return found ? await new Response(found.stream).json() : null;
      } catch {
        return null;
      }
    }),
  );
  return json({ count: events.length, events: events.filter(Boolean) });
}
