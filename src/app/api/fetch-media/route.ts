import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { looksLikeMedia, MAX_LINK_BYTES } from "@/lib/link-import";
import { fail, sameOrigin } from "@/server/http";

/**
 * GET /api/fetch-media?url=… — relays a media file to the browser.
 *
 * Used only when a host won't let the browser read its file directly (no CORS).
 * The bytes are streamed straight through and never written anywhere; the
 * browser still does the transcription.
 *
 * A URL-fetching endpoint is a classic SSRF hole, so every hop — including each
 * redirect — is resolved and refused if it lands on a private, loopback or
 * link-local address.
 */

export const maxDuration = 300;

const MAX_REDIRECTS = 5;

/**
 * Keep this from becoming a free open proxy on our bandwidth. Browsers mark
 * cross-site requests with Sec-Fetch-Site, so anything not same-origin is
 * refused; a per-IP hourly cap covers scripted callers that omit the header.
 * In-memory, so it's a pilot-scale guard, not a real limiter.
 */
const PER_IP_PER_HOUR = Number(process.env.LINK_IMPORT_HOURLY_LIMIT ?? 20);
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

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublic(u: URL): Promise<string | null> {
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Only http and https links can be imported.";
  if (u.username || u.password) return "Links with embedded credentials aren't supported.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) return "That link's server couldn't be found.";
  if (addrs.some((a) => privateAddress(a.address))) return "That link points at a private address and can't be imported.";
  return null;
}

export async function GET(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (!sameOrigin(req) || (site && site !== "same-origin")) {
    return fail("This request came from another site and was blocked.", 403);
  }
  if (overBudget(req)) return fail("Too many link imports this hour. Try again later, or download the file and drop it in.", 429);

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return fail("Missing url.", 400);

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return fail("That doesn't look like a link.", 400);
  }

  let upstream: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await assertPublic(url);
    if (blocked) return fail(blocked, 400);

    try {
      upstream = await fetch(url, {
        redirect: "manual", // follow by hand so each hop is re-checked
        headers: { "User-Agent": "Transcribio-LinkImport/1.0", Accept: "audio/*,video/*,*/*;q=0.5" },
        signal: req.signal,
      });
    } catch {
      return fail("The link's server didn't respond.", 502);
    }

    const next = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url);
    upstream = null;
  }

  if (!upstream) return fail("That link redirected too many times.", 502);
  if (upstream.status === 401 || upstream.status === 403) {
    return fail("That file isn't public. Change its sharing to “anyone with the link” and try again.", 400);
  }
  if (upstream.status === 404) return fail("Nothing was found at that link.", 400);
  if (!upstream.ok || !upstream.body) return fail(`The link's server returned an error (${upstream.status}).`, 502);

  const type = upstream.headers.get("content-type");
  if (!looksLikeMedia(type)) {
    upstream.body.cancel().catch(() => {});
    return fail("That link opens a web page, not an audio or video file.", 400);
  }

  const length = Number(upstream.headers.get("content-length")) || null;
  if (length && length > MAX_LINK_BYTES) {
    upstream.body.cancel().catch(() => {});
    return fail("That file is over 2 GB. Download it to your device and drop it in instead.", 413);
  }

  const headers = new Headers({ "Content-Type": type ?? "application/octet-stream", "Cache-Control": "no-store" });
  if (length) headers.set("Content-Length", String(length));
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return new Response(upstream.body, { status: 200, headers });
}
