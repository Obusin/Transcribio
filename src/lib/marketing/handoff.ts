/**
 * In-memory handoff from a funnel page's drop zone to the app.
 *
 * A File cannot survive a document load, but it survives a client-side
 * navigation, which is what `router.push` does. So a visitor who drops a file on
 * a landing page and is already signed in lands on /transcribe with the file
 * already chosen. Anyone who has to sign in first loses it and picks the file
 * again on the app's own drop zone — the funnel page says so rather than
 * pretending the file is being held somewhere.
 */

let pending: File | null = null;

export function setPendingFile(file: File): void {
  pending = file;
}

/** Returns the handed-off file once, then forgets it. */
export function takePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}

let pendingLink: string | null = null;

/** Same hand-off for a pasted link: the app starts the import on arrival. */
export function setPendingLink(url: string): void {
  pendingLink = url;
}

/**
 * Non-destructive read. React's dev StrictMode runs state initializers twice,
 * so a read-and-clear would hand the second call null and lose the link.
 */
export function peekPendingLink(): string | null {
  return pendingLink;
}

export function clearPendingLink(): void {
  pendingLink = null;
}
