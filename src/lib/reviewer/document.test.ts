import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { editedSegments } from "../transcript/store";
import { renderDocx } from "../transcript/render-docx";
import { renderPdf } from "../transcript/render-pdf";
import { buildReviewer, toSentences } from "./build";
import { reviewerExportDoc } from "./document";
import { lessonOne } from "./fixture";

const doc = reviewerExportDoc(lessonOne);

describe("reviewer export document", () => {
  test("topics, terms and questions each become a section", () => {
    expect(doc.title).toBe("2026-09-10 10-45-48 — Reviewer");
    const headings = doc.sections.map((s) => s.heading ?? "");
    expect(headings.some((h) => h.includes("Elton Mayo"))).toBe(true);
    expect(headings).toContain("Key terms");
    expect(headings).toContain("Review questions");
    expect(doc.facts.map((f) => f.label)).toContain("Topics");
  });

  test("every quoted line is a sentence the lecturer actually said", () => {
    const spoken = new Set(toSentences(editedSegments(lessonOne)).map((s) => s.text));
    const quoted = doc.sections.flatMap((s) => s.lines.filter((l) => l.style === "bullet").map((l) => l.text));
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.every((t) => spoken.has(t))).toBe(true);
  });

  test("questions are followed by their answer", () => {
    const section = doc.sections.find((s) => s.heading === "Review questions")!;
    const i = section.lines.findIndex((l) => l.lead?.includes("Hawthorne"));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(section.lines[i + 1].style).toBe("quiet");
    expect(section.lines[i + 1].text.length).toBeGreaterThan(20);
  });

  test("a reviewer with nothing in it says so rather than exporting an empty shell", () => {
    const tiny = { ...lessonOne, raw: { ...lessonOne.raw, segments: lessonOne.raw.segments.slice(0, 2) } };
    const d = reviewerExportDoc(tiny, buildReviewer(tiny));
    expect(d.notes.join(" ")).toContain("little spoken material");
  });
});

describe("reviewer renderers", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-reviewer-"));

  test("DOCX carries the headings, terms and Taglish text", async () => {
    const blob = await renderDocx(doc);
    const file = join(dir, "r.docx");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const text = execFileSync("textutil", ["-convert", "txt", "-stdout", file], { encoding: "utf8" });
    expect(text).toContain("Key terms");
    expect(text).toContain("Elton Mayo");
    expect(text).toContain("Hawthorne Effect");
    expect(text).toContain("nagbabago yung kanyang productivity");
    console.log(`      reviewer DOCX ${Math.round(blob.size / 1024)} KB → ${file}`);
  });

  test("PDF renders the bold leads without throwing", async () => {
    const fonts = {
      regular: readFileSync(join(import.meta.dir, "../../../public/fonts/NotoSans-Regular.ttf")),
      bold: readFileSync(join(import.meta.dir, "../../../public/fonts/NotoSans-Bold.ttf")),
    };
    const bytes = await renderPdf(doc, fonts);
    const file = join(dir, "r.pdf");
    writeFileSync(file, bytes);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toBe(doc.title);
    console.log(`      reviewer PDF ${parsed.getPageCount()} pages, ${Math.round(bytes.length / 1024)} KB → ${file}`);
  });
});
