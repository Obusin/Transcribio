import "server-only";
import { NextResponse } from "next/server";
import { ACCOUNTS_ENABLED } from "../lib/deployment";
import { AuthError, SESSION_COOKIE, userForToken, type User } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * Cookie-authenticated endpoints must refuse cross-site writes. SameSite=Lax
 * already blocks most; checking Origin against Host closes the rest.
 */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/**
 * Endpoints backed by the SQLite file. The hosted deployment has no writable
 * disk, so they are switched off rather than failing at the first query.
 */
export const accountsDisabled = () =>
  ACCOUNTS_ENABLED ? null : fail("This deployment runs without accounts — history stays in your browser.", 404);

export function requestUser(req: Request): User | null {
  // No accounts on this deployment: never open the database, even if an old
  // session cookie is still sitting in the browser.
  if (!ACCOUNTS_ENABLED) return null;
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return userForToken(token ? decodeURIComponent(token) : undefined);
}

/** Wraps a handler with origin checking, auth (optional) and error mapping. */
export function handler<C>(
  fn: (req: Request, ctx: C, user: User | null) => Promise<Response>,
  opts: { auth: boolean } = { auth: true },
) {
  return async (req: Request, ctx: C) => {
    if (!sameOrigin(req)) return fail("This request came from another site and was blocked.", 403);
    const user = requestUser(req);
    if (opts.auth && !user) return fail("Sign in to continue.", 401);
    try {
      return await fn(req, ctx, user);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.message, err.status);
      const message = err instanceof Error ? err.message : "Something went wrong.";
      console.error(err);
      return fail(message, 500);
    }
  };
}
