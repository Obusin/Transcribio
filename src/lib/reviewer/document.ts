import { longDate, type ExportDoc, type ExportLine } from "../transcript/document";
import { clock } from "../transcript/format";
import type { StoredTranscript } from "../transcript/store";
import { buildReviewer, type ReviewerDoc } from "./build";

/**
 * The reviewer laid out as a document, so the PDF and Word exports of a
 * reviewer go through exactly the same model as the transcript exports.
 */
export function reviewerExportDoc(record: StoredTranscript, reviewer: ReviewerDoc = buildReviewer(record)): ExportDoc {
  const title = `${record.title} — Reviewer`;
  const facts: ExportDoc["facts"] = [
    { label: "Topics", value: String(reviewer.topics.length) },
    ...(reviewer.glossary.length ? [{ label: "Key terms", value: String(reviewer.glossary.length) }] : []),
    ...(reviewer.questions.length ? [{ label: "Questions", value: String(reviewer.questions.length) }] : []),
    { label: "Recording", value: clock(record.raw.durationSeconds) },
    { label: "Transcribed", value: longDate(record.createdAt) },
  ];

  const notes = ["Organised from this recording on your device. Every line is quoted from the transcript — nothing was added."];
  if (reviewer.thin) notes.push("There was little spoken material to work with, so this reviewer is short.");

  const sections: ExportDoc["sections"] = [];
  reviewer.topics.forEach((t, i) => {
    sections.push({
      heading: `${i + 1}. ${t.title}`,
      meta: clock(t.start),
      lines: t.points.map((p): ExportLine => ({ stamp: clock(p.start), text: p.text, style: "bullet" })),
    });
  });
  if (reviewer.glossary.length) {
    sections.push({
      heading: "Key terms",
      lines: reviewer.glossary.map((g): ExportLine => ({ stamp: clock(g.start), lead: g.term, text: g.definition })),
    });
  }
  if (reviewer.lists.length) {
    sections.push({
      heading: "Lists to remember",
      lines: reviewer.lists.flatMap((l): ExportLine[] => [
        { stamp: clock(l.start), lead: l.title, text: "" },
        ...l.items.map((it): ExportLine => ({ stamp: clock(it.start), text: it.text, style: "bullet" })),
      ]),
    });
  }
  if (reviewer.facts.length) {
    sections.push({
      heading: "Dates, laws and figures",
      lines: reviewer.facts.map((f): ExportLine => ({ stamp: clock(f.start), text: f.text, style: "bullet" })),
    });
  }
  if (reviewer.questions.length) {
    sections.push({
      heading: "Review questions",
      lines: reviewer.questions.flatMap((q): ExportLine[] => [
        { stamp: clock(q.start), lead: q.question, text: "" },
        { stamp: "", text: q.answer, style: "quiet" },
      ]),
    });
  }

  return { title, facts, notes, sections, footer: `${title} · Transcribio` };
}
