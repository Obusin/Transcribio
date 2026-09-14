import { put } from "@vercel/blob";
import { MAX_CONTRIBUTION_BYTES, parseContribution } from "@/lib/contribution";
import { fail, json, sameOrigin } from "@/server/http";

/**
 * POST /api/contribute — a transcript the user explicitly chose to share.
 *
 * Only reachable from the share box on a finished transcript. Stored in the
 * private Blob store under contributions/, never public. parseContribution
 * rebuilds the body from an allow-list, so audio, file names or anything else
 * a caller adds is dropped rather than stored.
 */

const PER_IP_PER_HOUR = 30;
const seen = new Map<string, { count: number; resetAt: number }>();

function overBudget(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const hit = seen.get(ip);
  if (!hit || now > hit.resetAt) {
    seen.set(ip, { count: 1, resetAt: now + 3_600_000 });
    if (seen.size > 5000) for (const [k, v] of seen) if (now > v.resetAt) seen.delete(k);
    return false;
  }
  return ++hit.count > PER_IP_PER_HOUR;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("This request came from another site and was blocked.", 403);
  if (overBudget(req)) return fail("Too many shares this hour. Thank you — try again later.", 429);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail("Sharing isn't set up on this server.", 503);

  const length = Number(req.headers.get("content-length")) || 0;
  if (length > MAX_CONTRIBUTION_BYTES) return fail("This transcript is too large to share.", 413);

  const text = await req.text();
  if (text.length > MAX_CONTRIBUTION_BYTES) return fail("This transcript is too large to share.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("Expected JSON.", 400);
  }
  const envelope = body as { contribution?: unknown; device?: unknown; pilot?: unknown };
  const contribution = parseContribution(envelope?.contribution);
  if (!contribution || contribution.lines.length === 0) return fail("That doesn't look like a transcript.", 400);

  const at = new Date().toISOString();
  const record = {
    at,
    device: typeof envelope.device === "string" ? envelope.device.slice(0, 64) : "unknown",
    pilot: typeof envelope.pilot === "string" ? envelope.pilot.slice(0, 40) : undefined,
    ua: (req.headers.get("user-agent") ?? "").slice(0, 200),
    ...contribution,
  };

  try {
    await put(`contributions/${at.slice(0, 10)}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(record), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
  } catch (err) {
    console.error("contribution write failed", err);
    return fail("Couldn't save your share right now. Please try again.", 502);
  }
  return json({ ok: true });
}
