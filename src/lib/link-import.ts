/**
 * Paste-a-link import.
 *
 * The engine only ever transcribes a local File, so a link is turned into one:
 * the media is downloaded into the browser and then handled exactly like a
 * dropped file. Transcription still happens on the device.
 *
 * Getting the bytes is the hard part. Most hosts don't send CORS headers, so the
 * browser can't read their files directly; for those the download goes through
 * our /api/fetch-media relay, which streams the bytes on and keeps nothing.
 *
 * Video *platforms* (YouTube, Facebook, TikTok…) are a different problem: the
 * page URL is not a media file, and extracting the stream means running a
 * scraper those sites actively block. They are recognised and refused with an
 * explanation rather than failing mysteriously.
 */

export type LinkPlan =
  | { kind: "direct"; url: string; label: string }
  | { kind: "platform"; platform: string }
  | { kind: "invalid"; reason: string };

/** Largest download we will pull into the browser. Matches what a laptop can reasonably hold as a Blob. */
export const MAX_LINK_BYTES = 2 * 1024 ** 3;

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"],
  [/(^|\.)(tiktok\.com)$/, "TikTok"],
  [/(^|\.)(instagram\.com)$/, "Instagram"],
  [/(^|\.)(vimeo\.com)$/, "Vimeo"],
  [/(^|\.)(twitter\.com|x\.com)$/, "X"],
  [/(^|\.)(twitch\.tv)$/, "Twitch"],
  [/(^|\.)(spotify\.com)$/, "Spotify"],
  [/(^|\.)(zoom\.us)$/, "Zoom"],
];

/** Decides what a pasted link is and how to fetch it. Pure, so it is unit-tested. */
export function classifyLink(input: string): LinkPlan {
  const raw = input.trim();
  if (!raw) return { kind: "invalid", reason: "Paste a link first." };

  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { kind: "invalid", reason: "That doesn't look like a link." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { kind: "invalid", reason: "Only http and https links can be imported." };
  }

  const host = u.hostname.toLowerCase();

  for (const [re, name] of PLATFORMS) if (re.test(host)) return { kind: "platform", platform: name };

  // Google Drive share links point at a viewer page; rewrite to the file itself.
  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get("id");
    if (!id) return { kind: "invalid", reason: "That Google Drive link doesn't point at a single file." };
    return {
      kind: "direct",
      // `confirm=t` skips the "can't scan this file for viruses" page Drive shows for large files.
      url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
      label: "Google Drive file",
    };
  }

  // Dropbox share links render a preview unless asked for the raw file.
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    u.searchParams.delete("dl");
    u.searchParams.set("raw", "1");
    return { kind: "direct", url: u.toString(), label: fileNameFrom(u) ?? "Dropbox file" };
  }

  return { kind: "direct", url: u.toString(), label: fileNameFrom(u) ?? host };
}

function fileNameFrom(u: URL): string | null {
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : null;
}

/** Explanation shown when someone pastes a platform page link. */
export function platformMessage(platform: string): string {
  return `${platform} links can't be imported yet — a ${platform} page isn't a media file, and pulling the video out of it means running a downloader ${platform} actively blocks. Download the video to your device first, then drop the file in.`;
}

const MEDIA_TYPE = /^(audio|video)\//i;
const OPAQUE_TYPE = /^(application\/octet-stream|binary\/octet-stream|application\/ogg|application\/mp4)/i;

/** Hosts often mislabel media; accept anything that isn't obviously a web page. */
export function looksLikeMedia(contentType: string | null): boolean {
  if (!contentType) return true;
  return MEDIA_TYPE.test(contentType) || OPAQUE_TYPE.test(contentType);
}

export class LinkImportError extends Error {}

/**
 * Downloads a link into a File. Tries the browser directly first (fast, and the
 * bytes never touch our server); falls back to the relay when the host blocks
 * cross-origin reads.
 */
export async function importFromLink(
  plan: Extract<LinkPlan, { kind: "direct" }>,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<{ file: File; viaRelay: boolean }> {
  let res: Response | null = null;
  let viaRelay = false;

  try {
    res = await fetch(plan.url, { signal, mode: "cors", credentials: "omit" });
    if (!res.ok || !looksLikeMedia(res.headers.get("content-type"))) res = null;
  } catch (err) {
    if (signal?.aborted) throw err;
    res = null; // CORS refusal surfaces as a TypeError — that's the cue to relay.
  }

  if (!res) {
    viaRelay = true;
    res = await fetch(`/api/fetch-media?url=${encodeURIComponent(plan.url)}`, { signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new LinkImportError(body.error ?? `The link couldn't be downloaded (${res.status}).`);
    }
  }

  const type = res.headers.get("content-type") ?? "";
  if (!looksLikeMedia(type)) {
    throw new LinkImportError("That link opens a web page, not an audio or video file.");
  }

  const length = Number(res.headers.get("content-length")) || null;
  if (length && length > MAX_LINK_BYTES) {
    throw new LinkImportError("That file is over 2 GB. Download it to your device and drop it in instead.");
  }
  if (!res.body) throw new LinkImportError("The download came back empty.");

  // Two readers on one stream: the browser assembles the Blob itself (it pages
  // large blobs to disk), while we only count bytes for the progress bar. Reading
  // the chunks into our own array would put the whole file in the JS heap.
  const [forBlob, forCount] = res.body.tee();
  const blobPromise = new Response(forBlob).blob();

  const reader = forCount.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > MAX_LINK_BYTES) {
      await reader.cancel();
      throw new LinkImportError("That file is over 2 GB. Download it to your device and drop it in instead.");
    }
    onProgress(loaded, length);
  }

  const blob = await blobPromise;
  if (blob.size === 0) throw new LinkImportError("The download came back empty.");

  const name = nameFromHeaders(res.headers) ?? plan.label;
  return { file: new File([blob], name, { type: blob.type || type }), viaRelay };
}

function nameFromHeaders(h: Headers): string | null {
  const cd = h.get("content-disposition");
  if (!cd) return null;
  const star = cd.match(/filename\*\s*=\s*[^']*''([^;]+)/i)?.[1];
  if (star) return decodeURIComponent(star.trim().replace(/"/g, ""));
  return cd.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1]?.trim() ?? null;
}
