import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { ExportDoc } from "./document";

/**
 * Word document (.docx) — also opens in Google Docs and Pages. Timestamps sit
 * in a left column via a hanging indent, so wrapped lines stay aligned.
 */
const STAMP_COL = 1300; // twips (~0.9 in); wider for "1:23:53"
const FONT = "Arial";
const GRAY = "6B7280";

export async function renderDocx(doc: ExportDoc): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title, font: FONT, bold: true, size: 40 })], spacing: { after: 120 } }),
    new Paragraph({
      spacing: { after: 160 },
      children: doc.facts.flatMap((f, i) => [
        ...(i ? [new TextRun({ text: "   ·   ", color: GRAY, size: 18, font: FONT })] : []),
        new TextRun({ text: `${f.label} `, color: GRAY, size: 18, font: FONT }),
        new TextRun({ text: f.value, size: 18, font: FONT, bold: true }),
      ]),
    }),
    ...doc.notes.map((n) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: n, italics: true, color: "9A5B00", size: 19, font: FONT })] })),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D1D5DB", space: 1 } }, spacing: { after: 200 } }),
  ];

  // A converted document has no timestamps — don't reserve an empty gutter for them.
  const hasStamps = doc.sections.some((s) => s.lines.some((l) => l.stamp));
  for (const section of doc.sections) {
    if (section.heading) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 40 }, keepNext: true, children: [new TextRun({ text: section.heading, font: FONT, bold: true, size: 26 })] }));
    }
    if (section.meta) children.push(new Paragraph({ spacing: { after: 140 }, keepNext: true, children: [new TextRun({ text: section.meta, color: GRAY, size: 18, font: FONT })] }));
    for (const l of section.lines) {
      children.push(
        new Paragraph({
          ...(hasStamps
            ? { indent: { left: STAMP_COL, hanging: STAMP_COL }, tabStops: [{ type: TabStopType.LEFT, position: STAMP_COL }] }
            : {}),
          spacing: { after: 90, line: 290 },
          children: [
            ...(hasStamps
              ? [
                  new TextRun({ text: l.stamp, font: "Courier New", size: 17, color: GRAY }),
                  new TextRun({ text: "\t", font: FONT }),
                ]
              : []),
            ...(l.speaker ? [new TextRun({ text: `${l.speaker}: `, bold: true, font: FONT, size: 21 })] : []),
            ...(l.lead ? [new TextRun({ text: `${l.style === "bullet" ? "• " : ""}${l.lead}`, bold: true, font: FONT, size: 21 })] : []),
            ...(l.text
              ? [
                  new TextRun({
                    text: l.lead ? `  ${l.text}` : `${l.style === "bullet" ? "• " : ""}${l.text}`,
                    font: FONT,
                    size: 21,
                    ...(l.style === "quiet" ? { color: GRAY } : {}),
                  }),
                ]
              : []),
          ],
        }),
      );
    }
  }

  const document = new Document({
    creator: "Transcribio",
    title: doc.title,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${doc.footer}   ·   page `, color: GRAY, size: 16, font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], color: GRAY, size: 16, font: FONT }),
                  new TextRun({ text: " of ", color: GRAY, size: 16, font: FONT }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: GRAY, size: 16, font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
