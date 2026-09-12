import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExportDoc } from "./document";

/**
 * PDF export, laid out by hand: A4, embedded Noto Sans (subset) so Filipino
 * text — ñ, curly quotes, dashes — renders exactly, timestamps in a left
 * column, "page X of Y" footer.
 */
export interface PdfFonts {
  regular: Uint8Array | ArrayBuffer;
  bold: Uint8Array | ArrayBuffer;
}

const PAGE = { w: 595.28, h: 841.89 }; // A4 in points
const M = { top: 64, bottom: 64, x: 60 };
const INK = rgb(0.11, 0.13, 0.17);
const GRAY = rgb(0.42, 0.45, 0.5);
const AMBER = rgb(0.6, 0.36, 0);
const RULE = rgb(0.82, 0.84, 0.87);

/**
 * Characters the font can't draw (e.g. emoji) are dropped rather than shown as
 * "?", which would read like a transcription error.
 */
function sanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (s: string) =>
    Array.from(s.replace(/\t/g, " ").replace(/[\r\n]+/g, " "))
      .filter((ch) => ch === " " || supported.has(ch.codePointAt(0)!))
      .join("")
      .replace(/ {2,}/g, " ")
      .trimEnd();
}

/** Greedy word wrap by measured width; over-long words are broken by character. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= width) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > width) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function renderPdf(doc: ExportDoc, fonts: PdfFonts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(doc.title);
  pdf.setCreator("Transcribio");
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const clean = sanitizer(regular);
  const cleanBold = sanitizer(bold);

  const contentW = PAGE.w - 2 * M.x;
  // A converted document has no timestamps — don't reserve an empty gutter for them.
  const hasStamps = doc.sections.some((s) => s.lines.some((l) => l.stamp));
  const stampW = hasStamps
    ? Math.max(...doc.sections.flatMap((s) => s.lines.map((l) => regular.widthOfTextAtSize(l.stamp, 8.5))), 24) + 14
    : 0;
  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M.top;

  const ensure = (height: number) => {
    if (y - height < M.bottom) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M.top;
    }
  };
  const block = (text: string, font: PDFFont, size: number, color = INK, lead = 1.35, x = M.x, width = contentW) => {
    const lines = wrap(font === bold ? cleanBold(text) : clean(text), font, size, width);
    for (const l of lines) {
      ensure(size * lead);
      y -= size * lead;
      page.drawText(l, { x, y, size, font, color });
    }
  };

  // Header: title, facts, notes, rule.
  block(doc.title, bold, 20, INK, 1.25);
  y -= 6;
  block(doc.facts.map((f) => `${f.label} ${f.value}`).join("   ·   "), regular, 9, GRAY);
  for (const n of doc.notes) {
    y -= 3;
    block(n, regular, 9.5, AMBER);
  }
  y -= 12;
  page.drawLine({ start: { x: M.x, y }, end: { x: PAGE.w - M.x, y }, thickness: 0.75, color: RULE });
  y -= 10;

  const textSize = 10.5;
  const lead = textSize * 1.42;
  for (const section of doc.sections) {
    if (section.heading) {
      ensure(60); // keep a heading with at least its first lines
      y -= 14;
      block(section.heading, bold, 13, INK, 1.3);
      if (section.meta) block(section.meta, regular, 9, GRAY);
      y -= 6;
    }
    for (const l of section.lines) {
      const bullet = l.style === "bullet" ? "• " : "";
      // A lead (glossary term, question) is drawn bold on its own line, so the
      // wrapping stays simple and the eye can find it down the page.
      const leadLines = l.lead ? wrap(cleanBold(`${bullet}${l.lead}`), bold, textSize, contentW - stampW) : [];
      const body = l.speaker ? `${l.speaker}: ${l.text}` : l.text;
      const lines = body ? wrap(clean(l.lead ? body : `${bullet}${body}`), regular, textSize, contentW - stampW) : [];
      let stamped = false;
      const drawStamp = () => {
        if (!stamped && l.stamp) page.drawText(clean(l.stamp), { x: M.x, y: y + 0.5, size: 8.5, font: regular, color: GRAY });
        stamped = true;
      };
      ensure(lead * Math.min(leadLines.length + lines.length, 2)); // don't strand a single line at a page bottom
      for (const ln of leadLines) {
        ensure(lead);
        y -= lead;
        drawStamp();
        page.drawText(ln, { x: M.x + stampW, y, size: textSize, font: bold, color: INK });
      }
      for (const ln of lines) {
        ensure(lead);
        y -= lead;
        drawStamp();
        page.drawText(ln, { x: M.x + stampW, y, size: textSize, font: regular, color: l.style === "quiet" ? GRAY : INK });
      }
      y -= 4;
    }
  }

  // Footer on every page, now that the page count is known.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = clean(`${doc.footer}   ·   page ${i + 1} of ${pages.length}`);
    const size = 8;
    p.drawText(label, { x: PAGE.w - M.x - regular.widthOfTextAtSize(label, size), y: M.bottom / 2, size, font: regular, color: GRAY });
  });
  return pdf.save();
}

/** In the browser: load the bundled fonts, then render. */
export async function renderPdfInBrowser(doc: ExportDoc): Promise<Blob> {
  const [regular, bold] = await Promise.all(
    ["/fonts/NotoSans-Regular.ttf", "/fonts/NotoSans-Bold.ttf"].map(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error("Couldn't load the PDF font. Check your connection and try again.");
      return res.arrayBuffer();
    }),
  );
  const bytes = await renderPdf(doc, { regular, bold });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
