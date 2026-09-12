import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderDocx } from "../transcript/render-docx";
import { convertedExportDoc } from "./document";
import { blocksFromLines, bodySize, extractPdf, linesFromItems, NoTextLayerError, type PdfjsLike, type RawItem } from "./pdf-text";

// The Node/bun build; the browser loads "pdfjs-dist" instead.
const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
const fonts = join(import.meta.dir, "../../../node_modules/pdfjs-dist/standard_fonts/");

const item = (str: string, x: number, y: number, size: number, width = str.length * size * 0.5): RawItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

/** A PDF built the way a real one is: glyphs at coordinates, no paragraphs. */
async function samplePdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Interview Notes");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p1 = pdf.addPage([595.28, 841.89]);
  p1.drawText("Employee Screening", { x: 60, y: 760, size: 20, font: bold });
  p1.drawText("Screening is the process of reviewing information", { x: 60, y: 728, size: 11, font });
  p1.drawText("about applicants used to select workers.", { x: 60, y: 713, size: 11, font });
  p1.drawText("A resume is targeted for a specific job.", { x: 60, y: 672, size: 11, font });
  const p2 = pdf.addPage([595.28, 841.89]);
  p2.drawText("Second page paragraph.", { x: 60, y: 760, size: 11, font });
  return new Uint8Array(await pdf.save());
}

describe("rebuilding structure from coordinates", () => {
  test("items on one baseline become one line, with the gaps back as spaces", () => {
    const lines = linesFromItems([item("Hello", 60, 700, 11), item("world", 95, 700, 11), item("Next", 60, 685, 11)]);
    expect(lines).toHaveLength(2);
    expect(lines[0].y).toBe(700);
    expect(lines[0].items).toHaveLength(2);
  });

  test("items are read top to bottom regardless of the order they appear in the PDF", () => {
    const lines = linesFromItems([item("bottom", 60, 600, 11), item("top", 60, 700, 11)]);
    expect(lines.map((l) => l.items[0].str)).toEqual(["top", "bottom"]);
  });

  test("empty and non-text items are ignored", () => {
    const lines = linesFromItems([item("", 60, 700, 0), { type: "beginMarkedContent" }, item("real", 60, 700, 11)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].items[0].str).toBe("real");
  });

  test("wrapped lines rejoin into a paragraph; a wide gap starts a new one", () => {
    const lines = linesFromItems([
      item("This sentence carries on", 60, 700, 11),
      item("to the following line.", 60, 685, 11),
      item("A separate paragraph.", 60, 640, 11),
    ]);
    const blocks = blocksFromLines(lines, 11);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("This sentence carries on to the following line.");
    expect(blocks[1].text).toBe("A separate paragraph.");
  });

  test("a word broken across lines by a hyphen is put back together", () => {
    const lines = linesFromItems([item("organiza-", 60, 700, 11), item("tional psychology", 60, 685, 11)]);
    expect(blocksFromLines(lines, 11)[0].text).toBe("organizational psychology");
  });

  test("text set larger than the body becomes a heading", () => {
    const lines = linesFromItems([item("Chapter One", 60, 760, 20), item("Body text here.", 60, 730, 11)]);
    const blocks = blocksFromLines(lines, bodySize([lines]));
    expect(blocks[0]).toEqual({ kind: "heading", text: "Chapter One" });
    expect(blocks[1].kind).toBe("paragraph");
  });
});

describe("reading a real PDF", () => {
  test("pages, paragraphs and the title come back", async () => {
    const out = await extractPdf(pdfjs, await samplePdf(), { standardFontDataUrl: fonts });
    expect(out.pages).toHaveLength(2);
    expect(out.title).toBe("Interview Notes");
    expect(out.wordCount).toBeGreaterThan(20);
    const blocks = out.pages[0].blocks;
    expect(blocks[0]).toEqual({ kind: "heading", text: "Employee Screening" });
    expect(blocks[1].text).toBe("Screening is the process of reviewing information about applicants used to select workers.");
    expect(blocks[2].text).toBe("A resume is targeted for a specific job.");
    expect(out.pages[1].blocks[0].text).toBe("Second page paragraph.");
  });

  test("a PDF with no text layer is refused rather than silently producing an empty file", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]);
    const bytes = new Uint8Array(await pdf.save());
    expect(extractPdf(pdfjs, bytes, { standardFontDataUrl: fonts })).rejects.toBeInstanceOf(NoTextLayerError);
  });
});

describe("the converted Word document", () => {
  test("headings become sections and the text survives round-trip", async () => {
    const out = await extractPdf(pdfjs, await samplePdf(), { standardFontDataUrl: fonts });
    const doc = convertedExportDoc("notes.pdf", out, "2026-09-12T03:00:00Z");
    expect(doc.title).toBe("Interview Notes");
    expect(doc.sections[0].heading).toBe("Employee Screening");
    expect(doc.facts.find((f) => f.label === "Pages")?.value).toBe("2");
    // Nothing in a converted document has a timestamp.
    expect(doc.sections.every((s) => s.lines.every((l) => l.stamp === ""))).toBe(true);

    const blob = await renderDocx(doc);
    const dir = mkdtempSync(join(tmpdir(), "tb-convert-"));
    const file = join(dir, "c.docx");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const text = execFileSync("textutil", ["-convert", "txt", "-stdout", file], { encoding: "utf8" });
    expect(text).toContain("Employee Screening");
    expect(text).toContain("about applicants used to select workers.");
    expect(text).toContain("Second page paragraph.");
    console.log(`      converted DOCX ${Math.round(blob.size / 1024)} KB → ${file}`);
  });

  test("the file name is the fallback title when the PDF has no metadata title", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText("Some text.", { x: 60, y: 700, size: 11, font });
    const out = await extractPdf(pdfjs, new Uint8Array(await pdf.save()), { standardFontDataUrl: fonts });
    expect(convertedExportDoc("Lecture handout.pdf", out).title).toBe("Lecture handout");
  });
});
