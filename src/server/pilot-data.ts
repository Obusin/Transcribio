import "server-only";
import { get, list } from "@vercel/blob";

/**
 * Reads pilot data back out of the private Blob store for the admin page.
 * One small JSON object per event/contribution, newest first.
 */
export async function readJsonBlobs<T>(prefix: string, limit: number): Promise<T[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const all: { pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    all.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && all.length < 5000);

  const newest = all.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)).slice(0, limit);
  const rows = await Promise.all(
    newest.map(async (b) => {
      try {
        const found = await get(b.pathname, { access: "private", useCache: false });
        return found ? ((await new Response(found.stream).json()) as T) : null;
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is Awaited<T> => r !== null) as T[];
}

export function browserLabel(ua: string | undefined): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /OPR\//.test(ua) ? "Opera" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  return os ? `${br} · ${os}` : br;
}
