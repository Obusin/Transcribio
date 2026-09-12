import { longDate, type ExportDoc, type ExportLine } from "../transcript/document";
import type { ConvertedPdf } from "./pdf-text";

/**
 * A converted PDF as a document, using the same `ExportDoc` model the
 * transcript and reviewer exports use — so it renders through the same Word
 * renderer, with no timestamp column (nothing here has a timestamp).
 */
export function convertedExportDoc(fileName: string, pdf: ConvertedPdf, convertedAt = new Date().toISOString()): ExportDoc {
  const title = pdf.title ?? fileName.replace(/\.pdf$/i, "").trim() ?? "Converted document";

  const facts: ExportDoc["facts"] = [
    { label: "Pages", value: String(pdf.pages.length) },
    { label: "Words", value: pdf.wordCount.toLocaleString() },
    { label: "Converted", value: longDate(convertedAt) },
  ];

  const notes = ["Converted from PDF on your device — the file was never uploaded."];

  // A heading starts a new section; paragraphs fall under whatever came last.
  const sections: ExportDoc["sections"] = [];
  let current: ExportDoc["sections"][number] = { lines: [] };
  for (const page of pdf.pages) {
    for (const block of page.blocks) {
      if (block.kind === "heading") {
        if (current.lines.length || current.heading) sections.push(current);
        current = { heading: block.text, lines: [] };
      } else {
        current.lines.push({ stamp: "", text: block.text } satisfies ExportLine);
      }
    }
  }
  if (current.lines.length || current.heading) sections.push(current);

  return { title, facts, notes, sections: sections.length ? sections : [{ lines: [] }], footer: `${title} · Transcribio` };
}
