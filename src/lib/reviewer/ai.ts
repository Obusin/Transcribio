import type { ReviewerDoc, Sentence } from "./build";

/**
 * Contract for the AI reviewer.
 *
 * The model never returns transcript text. It returns *indices* into the
 * sentence list we sent it, and the server maps those back to the real
 * sentences and their real timestamps.
 *
 * That is deliberate, and it is what keeps the AI reviewer honest:
 * - it cannot invent a quote, because quotes are looked up, not generated;
 * - it cannot translate the transcript, because it never writes the body text;
 * - it cannot fabricate a timestamp, because timestamps come from our own data.
 *
 * What the model does author is the organising layer — topic titles, which term
 * is a key term, which sentence defines it, which sentence answers which
 * question. That is the part rules do badly and a model does well.
 */

/** What the model is asked to produce. Every number is an index into the sentences sent. */
export interface AiReviewerPlan {
  title: string;
  thin: boolean;
  topics: { title: string; points: number[] }[];
  glossary: { term: string; definition: number }[];
  lists: { title: string; items: number[] }[];
  facts: number[];
  questions: { question: string; answer: number }[];
}

/** JSON Schema sent to OpenRouter so the model replies in exactly this shape. */
export const AI_REVIEWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "thin", "topics", "glossary", "lists", "facts", "questions"],
  properties: {
    title: { type: "string", description: "A short title for the recording, in the language it was spoken." },
    thin: { type: "boolean", description: "True only if there is too little spoken material to organise." },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "points"],
        properties: {
          title: { type: "string" },
          points: { type: "array", items: { type: "integer" } },
        },
      },
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition"],
        properties: { term: { type: "string" }, definition: { type: "integer" } },
      },
    },
    lists: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "items"],
        properties: { title: { type: "string" }, items: { type: "array", items: { type: "integer" } } },
      },
    },
    facts: { type: "array", items: { type: "integer" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "integer" } },
      },
    },
  },
} as const;

export const AI_REVIEWER_SYSTEM_PROMPT = `You organise a transcript into a study reviewer. You are given numbered sentences from a recording.

You never write the transcript's words yourself. You only:
- group sentence numbers under topic titles,
- pick which sentences are key facts,
- name a term and point to the sentence that defines it,
- write a question and point to the sentence that answers it,
- title a list and point to its item sentences.

Hard rules:
1. NEVER translate. If the transcript is in Filipino or Taglish, every title, term and question you write must be in the same language and register the speaker used. Do not render Filipino speech into English.
2. Only use sentence numbers that were given to you. Never invent a number.
3. A sentence number may appear in at most one topic.
4. Cover the whole recording in order. Topics must be in chronological order and their points must be ascending.
5. Titles are labels, not summaries — short, concrete, drawn from what the speaker actually discussed.
6. A term belongs in the glossary only if the speaker actually explains it. A question belongs in questions only if a sentence genuinely answers it.
7. If the recording is a song, ambient noise, or too short to organise, set thin to true and return empty arrays.
8. Prefer fewer, better entries over padding. Omit a section entirely rather than filling it with weak material.`;

/** Bounds and drops indices the model got wrong rather than trusting it. */
function pick(sentences: Sentence[], i: number): Sentence | null {
  return Number.isInteger(i) && i >= 0 && i < sentences.length ? sentences[i] : null;
}

function pickMany(sentences: Sentence[], idx: number[], used?: Set<number>): Sentence[] {
  const out: Sentence[] = [];
  for (const i of idx ?? []) {
    if (used?.has(i)) continue;
    const s = pick(sentences, i);
    if (!s) continue;
    used?.add(i);
    out.push(s);
  }
  return out;
}

/**
 * Maps a model plan back onto real sentences. Anything the model got wrong —
 * an out-of-range index, a duplicated point, an empty topic — is dropped here
 * rather than rendered.
 */
export function planToDoc(plan: AiReviewerPlan, sentences: Sentence[], fallbackTitle: string): ReviewerDoc {
  const usedPoints = new Set<number>();

  const topics = (plan.topics ?? [])
    .map((t) => {
      // Sort by time, not by the order the model happened to list them, so a
      // topic always reads chronologically and its start really is its earliest point.
      const points = pickMany(sentences, t.points, usedPoints).sort((a, b) => a.start - b.start);
      return { title: (t.title ?? "").trim(), start: points[0]?.start ?? 0, points };
    })
    .filter((t) => t.title.length > 0 && t.points.length > 0)
    .sort((a, b) => a.start - b.start);

  const glossary = (plan.glossary ?? [])
    .map((g) => {
      const s = pick(sentences, g.definition);
      return s ? { term: (g.term ?? "").trim(), definition: s.text, start: s.start } : null;
    })
    .filter((g) => g !== null && g.term.length > 0)
    .map((g) => g!);

  const lists = (plan.lists ?? [])
    .map((l) => {
      const items = pickMany(sentences, l.items);
      return { title: (l.title ?? "").trim(), start: items[0]?.start ?? 0, items };
    })
    .filter((l) => l.title.length > 0 && l.items.length > 1);

  const facts = pickMany(sentences, plan.facts ?? []);

  const questions = (plan.questions ?? [])
    .map((q) => {
      const s = pick(sentences, q.answer);
      return s ? { question: (q.question ?? "").trim(), answer: s.text, start: s.start } : null;
    })
    .filter((q) => q !== null && q.question.length > 0)
    .map((q) => q!);

  const empty = !topics.length && !glossary.length && !lists.length && !facts.length && !questions.length;

  return {
    title: (plan.title ?? "").trim() || fallbackTitle,
    topics,
    glossary,
    lists,
    facts,
    questions,
    thin: Boolean(plan.thin) || empty,
  };
}
