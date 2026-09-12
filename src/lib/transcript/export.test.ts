import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { Segment, Transcript } from "../engine/types";
import { combineTranscripts } from "./combine";
import { buildExportDoc, exportFileName, longDate } from "./document";
import { renderDocx } from "./render-docx";
import { renderPdf } from "./render-pdf";
import type { StoredTranscript } from "./store";

const seg = (id: number, start: number, text: string): Segment => ({ id, start, end: start + 3, text, language: "tl" });
const rec = (title: string, segments: Segment[], over: Omit<Partial<StoredTranscript>, "raw"> & { raw?: Partial<Transcript> } = {}): StoredTranscript => ({
  id: crypto.randomUUID(),
  title,
  fileName: `${title}.mp4`,
  fileSize: 1,
  hasVideo: true,
  createdAt: "2026-09-11T03:00:00Z",
  updatedAt: "2026-09-11T03:00:00Z",
  edits: {},
  ...over,
  raw: {
    segments,
    durationSeconds: 600,
    modelId: "whisper-large-v3-turbo",
    engine: "browser-webgpu",
    language: "auto",
    detectedLanguages: ["tl"],
    createdAt: "2026-09-11T03:00:00Z",
    stats: { processingSeconds: 100, realtimeFactor: 6 },
    ...over.raw,
  },
});

const taglish = rec(
  "Señora’s “Taglish” lecture — part 1",
  [
    seg(0, 0, "So basically yung problem natin is the customer can’t book kasi walang nagre-reply."),
    seg(1, 65, "Niño said: “Mañana na lang” — okay lang ba? 🙂"),
    seg(2, 3725, "Supercalifragilisticexpialidocious".repeat(4) + " ends here."),
    ...Array.from({ length: 150 }, (_, i) => seg(3 + i, 4000 + i * 9, `Line ${i + 1}: ang Hawthorne effect ay pansamantalang pagtaas ng productivity pagkatapos ng isang bagong pagbabago sa trabaho.`)),
  ],
  { edits: { 0: "So basically, yung problem natin is the customer can’t book kasi walang nagre-reply." }, raw: { durationSeconds: 5400, partial: { stoppedAtSeconds: 5400 }, unreadable: [{ start: 120, end: 135 }] } },
);

describe("export document model", () => {
  const doc = buildExportDoc(taglish);
  test("facts, notes, edits applied, part-free layout", () => {
    expect(doc.facts.map((f) => f.label)).toEqual(["Length", "Language", "Transcribed", "Model"]);
    expect(doc.facts[1].value).toBe("Filipino/Taglish");
    expect(doc.facts[3].value).toBe("Whisper Turbo");
    expect(doc.notes.join(" ")).toContain("Partial transcript");
    expect(doc.notes.join(" ")).toContain("2:00–2:15");
    expect(doc.notes.join(" ")).toContain("corrections");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lines[0].text).toStartWith("So basically, yung");
    expect(doc.sections[0].lines[2].stamp).toBe("1:02:05");
  });
  test("combined transcripts get a section per part with part-local times", () => {
    const b = rec("Part two", [seg(0, 0, "Iba-iba tayo types of interviews."), seg(1, 626, "Primacy effect.")], { raw: { durationSeconds: 3030 } });
    const a = rec("Part one", [seg(0, 0, "Psychological Corporation."), seg(1, 85, "Hawthorne effect.")], { raw: { durationSeconds: 5093 } });
    const d = buildExportDoc(combineTranscripts([a, b], "Whole lecture"));
    expect(d.sections.map((s) => s.heading)).toEqual(["Part 1 — Part one", "Part 2 — Part two"]);
    expect(d.sections[1].lines.map((l) => l.stamp)).toEqual(["0:00", "10:26"]);
    expect(d.facts.find((f) => f.label === "Parts")?.value).toBe("2 recordings");
  });
  test("dates and file names", () => {
    expect(longDate("2026-09-11T03:00:00Z")).toBe("11 September 2026");
    expect(exportFileName('a/b: "c"?', "pdf")).toBe("a_b_ _c_.pdf");
  });
});

describe("renderers", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-export-"));
  const doc = buildExportDoc(taglish);

  test("DOCX opens and contains the text, accents and quotes intact", async () => {
    const blob = await renderDocx(doc);
    const file = join(dir, "t.docx");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const text = execFileSync("textutil", ["-convert", "txt", "-stdout", file], { encoding: "utf8" });
    expect(text).toContain("Señora’s “Taglish” lecture — part 1");
    expect(text).toContain("Niño said: “Mañana na lang” — okay lang ba?");
    expect(text).toContain("So basically, yung problem natin");
    expect(text).toContain("1:02:05");
    expect(text).toContain("Partial transcript");
    console.log(`      DOCX ${Math.round(blob.size / 1024)} KB → ${file}`);
  });

  test("PDF renders multiple pages with an embedded font, footer and title", async () => {
    const fonts = {
      regular: readFileSync(join(import.meta.dir, "../../../public/fonts/NotoSans-Regular.ttf")),
      bold: readFileSync(join(import.meta.dir, "../../../public/fonts/NotoSans-Bold.ttf")),
    };
    const bytes = await renderPdf(doc, fonts);
    const file = join(dir, "t.pdf");
    writeFileSync(file, bytes);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(parsed.getTitle()).toBe(doc.title);
    // An embedded TrueType font (not a stand-in): some FontDescriptor carries a FontFile2 stream.
    const embedded = parsed.context
      .enumerateIndirectObjects()
      .some(([, obj]) => obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("FontDescriptor") && obj.has(PDFName.of("FontFile2")));
    expect(embedded).toBe(true);
    expect(bytes.length).toBeLessThan(400_000); // subsetting keeps it small
    console.log(`      PDF ${parsed.getPageCount()} pages, ${Math.round(bytes.length / 1024)} KB → ${file}`);
  });
});
