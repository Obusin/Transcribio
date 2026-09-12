/**
 * Reads the text out of a PDF and rebuilds it as headings and paragraphs.
 *
 * A PDF has no paragraphs — only glyphs at coordinates — so the structure is
 * inferred from geometry: items at the same baseline form a line, lines with
 * normal leading form a paragraph, a bigger vertical gap starts a new one, and
 * a line set noticeably larger than the body text is a heading.
 *
 * pdf.js is passed in rather than imported, so this file stays testable and the
 * browser build is loaded only when the user actually converts something.
 */

/** The part of a pdf.js text item we use. */
export interface RawItem {
  str: string;
  /** [a, b, c, d, x, y] — we read x (4) and y (5). */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface Line {
  y: number;
  size: number;
  items: RawItem[];
}

export interface Block {
  kind: "heading" | "paragraph";
  text: string;
}

export interface ConvertedPage {
  page: number;
  blocks: Block[];
}

export interface ConvertedPdf {
  /** From the PDF's metadata, when it has a usable one. */
  title?: string;
  pages: ConvertedPage[];
  wordCount: number;
}

/** Thrown when a PDF is a scan: pictures of words, with no text layer to read. */
export class NoTextLayerError extends Error {
  constructor() {
    super("This PDF has no text in it — it looks like a scan or photos of pages. Converting it would need OCR, which this tool doesn't do.");
    this.name = "NoTextLayerError";
  }
}

/** The shape we need from pdf.js; structural so tests can pass the legacy build. */
export interface PdfjsLike {
  getDocument(src: {
    data: Uint8Array;
    standardFontDataUrl?: string;
    cMapUrl?: string;
    cMapPacked?: boolean;
    isEvalSupported?: boolean;
  }): { promise: Promise<PdfDocumentLike> };
}

interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
  getMetadata?(): Promise<{ info?: { Title?: unknown } }>;
  destroy?(): Promise<void> | void;
}

const isItem = (v: unknown): v is RawItem => {
  const i = v as RawItem;
  return !!i && typeof i.str === "string" && Array.isArray(i.transform) && i.transform.length >= 6;
};

const sizeOf = (i: RawItem) => i.height || Math.abs(i.transform[3]) || 11;

/** Group items onto shared baselines, left to right, top to bottom. */
export function linesFromItems(items: unknown[]): Line[] {
  const usable = items.filter(isItem).filter((i) => i.str.trim() !== "");
  const sorted = [...usable].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines: Line[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const size = sizeOf(it);
    const last = lines[lines.length - 1];
    // Superscripts and mixed fonts shift the baseline slightly; tolerate that.
    if (last && Math.abs(last.y - y) <= Math.max(1.5, 0.3 * Math.max(size, last.size))) {
      last.items.push(it);
      last.size = Math.max(last.size, size);
    } else {
      lines.push({ y, size, items: [it] });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.transform[4] - b.transform[4]);
  return lines;
}

/** One line's text, restoring the spaces that are only gaps in the PDF. */
export function lineText(line: Line): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const it of line.items) {
    const x = it.transform[4];
    if (prevEnd !== null && x - prevEnd > 0.25 * line.size && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    out += it.str;
    prevEnd = x + (it.width ?? 0);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Join wrapped lines, undoing the hyphen a PDF uses to break a word. */
function joinLines(parts: string[]): string {
  let out = "";
  for (const p of parts) {
    if (!out) {
      out = p;
      continue;
    }
    if (/[a-zà-ÿ]-$/i.test(out) && /^[a-zà-ÿ]/.test(p)) out = `${out.slice(0, -1)}${p}`;
    else out += ` ${p}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The size most of the document is *set in* — the yardstick for "this is a
 * heading". Weighted by characters, not by lines: a page has few heading lines
 * and many body lines, but a plain median over lines gets it backwards on a
 * short document (two lines, one of each, and the heading wins).
 */
export function bodySize(pages: Line[][]): number {
  const weighted = pages
    .flat()
    .map((l) => ({ size: l.size, weight: Math.max(1, lineText(l).length) }))
    .sort((a, b) => a.size - b.size);
  if (!weighted.length) return 11;
  const half = weighted.reduce((n, w) => n + w.weight, 0) / 2;
  let seen = 0;
  for (const w of weighted) {
    seen += w.weight;
    if (seen >= half) return w.size;
  }
  return weighted[weighted.length - 1].size;
}

export function blocksFromLines(lines: Line[], body: number): Block[] {
  const blocks: Block[] = [];
  let parts: string[] = [];
  let lastY = 0;
  let size = body;
  const flush = () => {
    const text = joinLines(parts);
    if (text) blocks.push({ kind: "paragraph", text });
    parts = [];
  };
  for (const line of lines) {
    const text = lineText(line);
    if (!text) continue;
    // Set larger than the body text, and short enough to be a title, not a pull quote.
    if (line.size >= body * 1.18 && text.length <= 120) {
      flush();
      blocks.push({ kind: "heading", text });
      continue;
    }
    if (parts.length && lastY - line.y > 1.75 * Math.max(line.size, size)) flush();
    parts.push(text);
    lastY = line.y;
    size = Math.max(size, line.size);
  }
  flush();
  return blocks;
}

const countWords = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

export async function extractPdf(
  pdfjs: PdfjsLike,
  data: Uint8Array,
  opts: {
    standardFontDataUrl?: string;
    cMapUrl?: string;
    /** Called after each page, so a long document can show progress. */
    onPage?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ConvertedPdf> {
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: opts.standardFontDataUrl,
    cMapUrl: opts.cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
  });
  const doc = await task.promise;
  try {
    const perPage: Line[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (opts.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      perPage.push(linesFromItems(content.items));
      opts.onPage?.(n, doc.numPages);
    }
    const body = bodySize(perPage);
    const pages = perPage.map((lines, i) => ({ page: i + 1, blocks: blocksFromLines(lines, body) }));
    const wordCount = pages.reduce((n, p) => n + p.blocks.reduce((m, b) => m + countWords(b.text), 0), 0);
    if (wordCount === 0) throw new NoTextLayerError();

    const meta = await doc.getMetadata?.().catch(() => undefined);
    const raw = meta?.info?.Title;
    const title = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    return { title, pages, wordCount };
  } finally {
    await doc.destroy?.();
  }
}
