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
