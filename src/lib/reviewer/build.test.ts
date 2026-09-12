import { describe, expect, test } from "bun:test";
import { buildReviewer, findDefinitions, findFacts, findLists, splitTopics, toSentences } from "./build";
import { lessonOne, lessonTwo } from "./fixture";
import { editedSegments } from "../transcript/store";

const sentencesOf = (r: typeof lessonOne) => toSentences(editedSegments(r));
const has = (haystack: string[], needle: string) => haystack.some((h) => h.toLowerCase().includes(needle.toLowerCase()));

describe("sentences", () => {
  test("segments become sentences that keep their start time", () => {
    const s = sentencesOf(lessonOne);
    expect(s[0].text).toBe("It's a company or it's an organization that produces or publishes psychological tests.");
    expect(s[0].start).toBe(0);
    expect(s.every((x) => x.text.length > 0)).toBe(true);
  });
});

describe("topics", () => {
  const topics = splitTopics(sentencesOf(lessonOne));
  test("splits where the lecturer announces a new topic", () => {
    const titles = topics.map((t) => t.title);
    expect(has(titles, "Elton Mayo")).toBe(true);
    expect(has(titles, "Walter Bingham")).toBe(true);
    expect(has(titles, "specialization")).toBe(true);
    expect(has(titles, "information age")).toBe(true);
    expect(has(titles, "human resources")).toBe(true);
  });
  test("each topic starts at the moment it was announced", () => {
    const mayo = topics.find((t) => t.title.toLowerCase().includes("elton mayo"))!;
    expect(mayo.start).toBe(189);
    expect(topics.map((t) => t.start)).toEqual([...topics.map((t) => t.start)].sort((a, b) => a - b));
  });
  test("lesson two splits on its own cues", () => {
    const titles = splitTopics(sentencesOf(lessonTwo)).map((t) => t.title);
    expect(has(titles, "style of interview")).toBe(true);
    expect(has(titles, "employee screening")).toBe(true);
  });
});

describe("glossary", () => {
  const g = findDefinitions(sentencesOf(lessonOne));
  const two = findDefinitions(sentencesOf(lessonTwo));
  test("picks up terms the lecturer defines, quoted verbatim", () => {
    const terms = g.map((e) => e.term);
    expect(has(terms, "Hawthorne Effect")).toBe(true);
    expect(has(terms, "human resources")).toBe(true);
    const hawthorne = g.find((e) => e.term.toLowerCase().includes("hawthorne"))!;
    expect(hawthorne.definition).toContain("phenomenon wherein");
    expect(hawthorne.start).toBeGreaterThan(0);
  });
  test("works on lesson two too", () => {
    expect(has(two.map((e) => e.term), "employee screening")).toBe(true);
  });
  test("never invents text — every definition is a sentence from the transcript", () => {
    const spoken = new Set(sentencesOf(lessonOne).map((s) => s.text));
    expect(g.every((e) => spoken.has(e.definition))).toBe(true);
  });
});

describe("lists and facts", () => {
  test("finds the two kinds of interview", () => {
    const lists = findLists(sentencesOf(lessonTwo));
    expect(lists.length).toBeGreaterThan(0);
    expect(lists[0].title).toContain("dalawa klase ng interview");
    expect(lists[0].items.length).toBeGreaterThanOrEqual(2);
  });
  test("keeps years and laws", () => {
    const facts = findFacts(sentencesOf(lessonOne)).map((f) => f.text);
    expect(has(facts, "1924")).toBe(true);
    expect(has(facts, "1946")).toBe(true);
    expect(has(facts, "Republic Act 8759")).toBe(true);
  });
});

describe("reviewer document", () => {
  const doc = buildReviewer(lessonOne);
  test("has topics, glossary, facts and questions", () => {
    expect(doc.topics.length).toBeGreaterThanOrEqual(4);
    expect(doc.glossary.length).toBeGreaterThanOrEqual(2);
    expect(doc.questions.length).toBeGreaterThanOrEqual(4);
    expect(doc.thin).toBe(false);
  });
  test("questions carry an answer and a timestamp to jump to", () => {
    const q = doc.questions.find((x) => x.question.toLowerCase().includes("hawthorne"))!;
    expect(q.question).toStartWith("What is");
    expect(q.answer.length).toBeGreaterThan(20);
    expect(q.start).toBeGreaterThan(0);
    expect(doc.questions.some((x) => x.question.includes("Republic Act 8759"))).toBe(true);
  });
  test("a clip with nothing to extract is marked thin instead of padded out", () => {
    const tiny = { ...lessonOne, raw: { ...lessonOne.raw, segments: lessonOne.raw.segments.slice(0, 2) } };
    expect(buildReviewer(tiny).thin).toBe(true);
  });
});
