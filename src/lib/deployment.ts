/**
 * What this deployment can do.
 *
 * Accounts are backed by a SQLite file on the machine running the app, so they
 * only work on a host with a writable disk. Vercel's functions have no such
 * disk, so the hosted build runs **anonymous**: no sign-in, no server-side
 * storage, history kept per-browser in IndexedDB.
 *
 * Set NEXT_PUBLIC_ACCOUNTS=1 when self-hosting somewhere with a disk to get the
 * email-code accounts and "Save to my account" back.
 */
export const ACCOUNTS_ENABLED = process.env.NEXT_PUBLIC_ACCOUNTS === "1";

const DEVICE_KEY = "transcribio.device";

/**
 * A random id for this browser, used only to namespace the local IndexedDB
 * cache and to group this browser's own telemetry. It is generated on the
 * device, never tied to an identity, and never sent with any content.
 */
export function localDeviceId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    const found = localStorage.getItem(DEVICE_KEY);
    if (found) return found;
    const made = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // Private mode or blocked storage: stay usable, just don't persist history.
    return "anon";
  }
}
