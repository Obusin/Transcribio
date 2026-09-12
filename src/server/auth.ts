import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authSecret, db } from "./db";
import { sendLoginCode, type Delivery } from "./mail";

/**
 * Passwordless sign-in with a 6-digit email code.
 *
 * Only hashes are stored: codes as HMAC-style SHA-256 with a server secret,
 * sessions as SHA-256 of a 32-byte random token that lives in an httpOnly
 * cookie. Limits: 10-minute codes, 5 guesses per code, 30 s between sends,
 * 5 sends per hour per email.
 */

export const SESSION_COOKIE = "tb_session";
const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const RESEND_GAP_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export interface User {
  id: string;
  email: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (email: string, code: string) => sha256(`${authSecret()}:${email}:${code}`);

export function normalizeEmail(input: unknown): string {
  const email = String(input ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  return email;
}

export async function requestCode(emailInput: unknown): Promise<Delivery> {
  const email = normalizeEmail(emailInput);
  const d = db();
  const now = Date.now();
  const prev = d.prepare("SELECT sent_at, sends_in_window, window_start FROM login_codes WHERE email = ?").get(email) as
    | { sent_at: number; sends_in_window: number; window_start: number }
    | undefined;
  if (prev && now - prev.sent_at < RESEND_GAP_MS) {
    throw new AuthError(`Please wait ${Math.ceil((RESEND_GAP_MS - (now - prev.sent_at)) / 1000)} seconds before asking for another code.`, 429);
  }
  const inWindow = prev && now - prev.window_start < 3600_000;
  if (inWindow && prev.sends_in_window >= MAX_SENDS_PER_HOUR) {
    throw new AuthError("Too many codes requested for this email. Try again in an hour.", 429);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  d.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at, sends_in_window, window_start)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at, sends_in_window = excluded.sends_in_window, window_start = excluded.window_start`,
  ).run(email, codeHash(email, code), now + CODE_TTL_MS, now, inWindow ? prev.sends_in_window + 1 : 1, inWindow ? prev.window_start : now);
  return sendLoginCode(email, code);
}

/** Checks the code; on success creates the account if needed and returns a new session token. */
export function verifyCode(emailInput: unknown, codeInput: unknown): { user: User; token: string } {
  const email = normalizeEmail(emailInput);
  const code = String(codeInput ?? "").replace(/\D/g, "");
  const d = db();
  const row = d.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").get(email) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) throw new AuthError("That code has expired. Ask for a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new AuthError("Too many wrong codes. Ask for a new one.", 429);
  const a = Buffer.from(row.code_hash, "hex");
  const b = Buffer.from(codeHash(email, code), "hex");
  if (code.length !== 6 || !timingSafeEqual(a, b)) {
    d.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new AuthError(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new one.");
  }
  d.prepare("DELETE FROM login_codes WHERE email = ?").run(email);

  let user = d.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as User | undefined;
  if (!user) {
    user = { id: randomUUID(), email };
    d.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(user.id, email, new Date().toISOString());
  }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  d.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), user.id, now, now + SESSION_TTL_MS);
  d.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  return { user: { id: user.id, email: user.email }, token };
}

export function userForToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db()
    .prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .get(sha256(token), Date.now()) as User | undefined;
  return row ? { id: row.id, email: row.email } : null;
}

export function endSession(token: string | undefined) {
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** The signed-in user for the current request (Server Components and Route Handlers). */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return userForToken(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
});
