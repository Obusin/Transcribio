import type { Segment } from "../engine/types";
import { editedSegments, type StoredTranscript } from "../transcript/store";

/**
 * Turns a finished transcript into a reviewer — topics, glossary, lists, facts
 * and review questions — using only what the lecturer said.
 *
 * Everything is quoted from the transcript, so nothing can be invented. This
 * runs entirely on the device: no AI model, no network, instant.
 */

export interface Sentence {
  text: string;
  start: number;
}

export interface ReviewerTopic {
  title: string;
  start: number;
  points: Sentence[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  start: number;
}

export interface ReviewerList {
  title: string;
  items: Sentence[];
  start: number;
}

export interface ReviewerQuestion {
  question: string;
  answer: string;
  start: number;
}

export interface ReviewerDoc {
  title: string;
  topics: ReviewerTopic[];
  glossary: GlossaryEntry[];
  lists: ReviewerList[];
  facts: Sentence[];
  questions: ReviewerQuestion[];
  /** Nothing useful could be extracted (e.g. a song, or a very short clip). */
  thin: boolean;
}

// English + Filipino function words: ignored when scoring what a topic is about.
const STOP = new Set(
  `a an the and or but so then than that this these those there here is are was were be been being am do does did doing have has had having i you he she it we they me him her us them my your his its our their of in on at to for from with without about into over under again further once all any both each few more most other some such no nor not only own same too very can will just should now what which who whom when where why how if because as until while during before after above below up down out off over under okay ok yeah yes right well like get got going go really actually maybe kind sort thing things lot lots one two also even still back way say says said see seen look looking make makes made use used using
  ang mga ng sa na ay at ito iyon yun yung ako ikaw siya kami tayo kayo sila ko mo niya namin natin ninyo nila akin iyo kanya amin atin inyo kanila po ba naman lang din rin pa nga eh ha ho kung kapag pag para dahil kasi pero kaya tapos saka noon ngayon dito doon diyan ganito ganyan ganoon ganun meron mayroon wala hindi oo opo sige alam gusto puwede pwede dapat talaga sobra medyo parang halimbawa kumbaga diba di ano anong sino saan kailan bakit paano ilan isa dalawa marami konti lahat iba ibang mismo nang pala yan yata nyo natin`
    .split(/\s+/)
    .filter(Boolean),
);

/** Cue phrases a lecturer uses when moving to a new topic. */
const TOPIC_CUES: RegExp[] = [
  /^(?:okay,?\s*)?(?:so,?\s*)?next(?:,)?\s+(?:we have|let'?s|tayo|naman|is)?\s*(.*)$/i,
  /^(?:okay,?\s*)?(?:so,?\s*)?(?:now,?\s*)?let'?s\s+(?:go to|talk about|proceed (?:to|with)|discuss|move on to)\s+(.*)$/i,
  // "ngayon" on its own just means "now" and turns up mid-sentence all the
  // time, so it only counts as a cue when a transition marker follows it.
  /^(?:ngayon|susunod)\b,?\s*(?:naman\b,?\s*)?(?:tayo\b,?\s*)?(?:(?:let'?s\s+)?(?:go to|tignan|tingnan|talakayin|puntahan)|sa|ang|yung|ay)\s+(.*)$/i,
  /^(?:okay,?\s*)?(?:so,?\s*)?(?:we|let'?s)\s+(?:will\s+)?(?:now\s+)?(?:focus on|start with|begin with)\s+(.*)$/i,
  /^(?:okay,?\s*)?(?:so,?\s*)?(?:this|that)\s+(?:brings us to|leads us to)\s+(.*)$/i,
  /^(?:lesson|topic|part|chapter)\s+\d+\b(.*)$/i,
];

/** "When we say X…", "ang X ay…", "tinatawag na X" — how definitions are spoken. */
const DEFINITION_PATTERNS: { rx: RegExp; group: number }[] = [
  { rx: /\bwhen we say\s+([^,.:;]{2,45}?)\s*,?\s*(?:this|it|these|ito|yan)\b/i, group: 1 },
  { rx: /\b(?:is|are)\s+(?:called|known as|termed|referred to as)\s+(?:the\s+)?([^,.;:]{2,45})/i, group: 1 },
  { rx: /\btinatawag(?:\s+(?:din|natin|nating|nila))?\s+na\s+([^,.;:]{2,45})/i, group: 1 },
  { rx: /\b(?:pag|kapag|kung)\s+(?:sinabi|sinasabi|say)\s+nating?\s+([^,.;:]{2,45})/i, group: 1 },
  { rx: /\b(?:so\s+)?(?:ang|yung|ito(?:ng)?)\s+([^,.;:]{2,45}?)\s+ay\s+(?:isang?\s+|ang\s+)?\S+/i, group: 1 },
  { rx: /^([A-Z][\w'’-]*(?:\s+[\w'’-]+){0,4})\s+(?:is|are)\s+(?:a|an|the)\s+\S+/, group: 1 },
  { rx: /\b([\w'’-]+(?:\s+[\w'’-]+){0,4})\s+(?:refers? to|pertains? to|means)\s+\S+/i, group: 1 },
];

const LIST_CUES =
  /\b(?:may|meron|mayroon|there (?:are|were)|we have|dalawa|tatlo|apat|lima)\b[^.?!]{0,40}\b(?:klase|uri|types?|kinds?|ways?|paraan|pamamaraan|methods?|categories)\b|\b(?:types?|kinds?|categories|klase|uri)\s+of\b/i;
const ITEM_CUES =
  /^(?:first|second|third|fourth|fifth|next|then|another|lastly|finally|una|pangalawa|pangatlo|pang-?apat|panlima|sunod|isa pa|meron ding|meron din|pwede ring|pwede rin|pag|kapag|when)\b/i;

const FACT_YEAR = /\b(1[5-9]\d{2}|20[0-4]\d)\b/;
const FACT_LAW = /\b(?:R\.?A\.?|Republic Act|Executive Order|E\.?O\.?)\s*(?:No\.?\s*)?\d{3,5}\b/i;
const FACT_ACRONYM = /\b[A-Z]{2,6}\b/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Fillers and short asides that come before a cue: "Okay, how? Let's go to…". */
const LEAD_IN = /^(?:okay|ok|alright|so|sige|ano|eh|um|uh|yeah|yes|right|and|but|well|ayan|ayun)\b[,.!?\s]*/i;
const SHORT_ASIDE = /^[^.?!]{0,24}\?\s*/;
function cueText(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(LEAD_IN, "").replace(SHORT_ASIDE, "");
    if (t === before) break;
  }
  return t;
}
/** Articles and discourse markers a term gets dragged in with: "So yung Hawthorne Effect". */
const TERM_PREFIX = /^(?:so|and|but|okay|ok|then|well|eh|kasi|kaya|ayan|ayun|ngayon|the|a|an|ang|yung|yong|ito|itong|mga|sa|ng)\s+/i;
const normalizeTerm = (s: string) => {
  let t = clean(s);
  for (let i = 0; i < 4; i++) {
    const next = t.replace(TERM_PREFIX, "");
    if (next === t) break;
    t = next;
  }
  return t.replace(/[.,;:!?"“”'’]+$/g, "").trim();
};
const termKey = (s: string) => normalizeTerm(s).toLowerCase();

/** Merge segments into sentences, keeping the time the sentence started. */
export function toSentences(segments: Segment[]): Sentence[] {
  const out: Sentence[] = [];
  let buffer = "";
  let start = 0;
  for (const s of segments) {
    const text = clean(s.text);
    if (!text) continue;
    if (!buffer) start = s.start;
    buffer = buffer ? `${buffer} ${text}` : text;
    if (/[.?!]["'”’)]?$/.test(buffer) || buffer.length > 260) {
      out.push({ text: clean(buffer), start });
      buffer = "";
    }
  }
  if (buffer) out.push({ text: clean(buffer), start });
  return out;
}

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? [])
    // "it's" is the stop word "it", not a topic worth naming a section after.
    .map((w) => w.replace(/['’]s$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The words that stand out across the whole lecture, used to name topics. */
function keyTerms(sentences: Sentence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sentences) {
    for (const w of new Set(contentWords(s.text))) counts.set(w, (counts.get(w) ?? 0) + 1);
    // Capitalized names carry more weight than ordinary words.
    for (const m of s.text.matchAll(/\b([A-Z][a-z’'-]{2,})\b/g)) {
      const w = m[1].toLowerCase();
      if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1.5);
    }
  }
  return counts;
}

function titleFromCue(rest: string): string | null {
  const t = normalizeTerm(rest.replace(/\b(?:is|are|about|topic|natin|tayo|po|ulit)\b/gi, " "))
    .split(/[,.;:?!]/)[0]
    .trim();
  const words = t.split(/\s+/).filter(Boolean).slice(0, 7);
  if (words.length === 0) return null;
  const title = words.join(" ");
  return title.length >= 3 && /[\p{L}]/u.test(title) ? title : null;
}

function titleFromContent(sentences: Sentence[], global: Map<string, number>): string {
  const local = new Map<string, number>();
  for (const s of sentences) for (const w of contentWords(s.text)) local.set(w, (local.get(w) ?? 0) + 1);
  const ranked = [...local.entries()]
    .filter(([, n]) => n >= 2)
    // Favour words that are frequent here but not everywhere in the lecture.
    .map(([w, n]) => [w, n / Math.sqrt(global.get(w) ?? 1)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
  return ranked.length ? ranked.map((w) => w[0].toUpperCase() + w.slice(1)).join(" · ") : "Discussion";
}

/** Split into topics at the lecturer's cue phrases (never shorter than `minSeconds`). */
export function splitTopics(sentences: Sentence[], minSeconds = 30): { title: string; start: number; sentences: Sentence[] }[] {
  const global = keyTerms(sentences);
  const topics: { title: string | null; start: number; sentences: Sentence[] }[] = [{ title: null, start: sentences[0]?.start ?? 0, sentences: [] }];
  for (const s of sentences) {
    const current = topics[topics.length - 1];
    let cueTitle: string | null = null;
    const spoken = cueText(s.text);
    for (const rx of TOPIC_CUES) {
      const m = spoken.match(rx);
      if (m) {
        cueTitle = titleFromCue(m[1] ?? "");
        break;
      }
    }
    // Guard on time, not sentence count: how many sentences a topic holds says
    // more about how the audio was segmented than about how long it ran.
    const longEnough = s.start - current.start >= minSeconds;
    if (cueTitle && longEnough) topics.push({ title: cueTitle, start: s.start, sentences: [s] });
    else current.sentences.push(s);
  }
  return topics
    // A topic the lecturer announced by name is real even if short; one we only
    // inferred from its content needs enough substance to be worth a heading.
    .filter((t) => (t.title !== null || t.sentences.length >= 2) && t.sentences.length > 0)
    .map((t) => ({ title: t.title ?? titleFromContent(t.sentences, global), start: t.start, sentences: t.sentences }));
}

/** Sentences that look like the substance of a topic, in the order spoken. */
function pickPoints(sentences: Sentence[], global: Map<string, number>, max = 6): Sentence[] {
  const scored = sentences.map((s, i) => {
    const words = contentWords(s.text);
    if (words.length < 4) return { s, i, score: -1 };
    let score = words.reduce((n, w) => n + 1 / Math.sqrt(global.get(w) ?? 1), 0) / Math.sqrt(words.length);
    if (DEFINITION_PATTERNS.some((p) => p.rx.test(s.text))) score += 1.2;
    if (FACT_YEAR.test(s.text) || FACT_LAW.test(s.text)) score += 0.8;
    if (LIST_CUES.test(s.text)) score += 0.6;
    if (s.text.length > 320) score -= 0.5;
    return { s, i, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

export function findDefinitions(sentences: Sentence[], max = 40): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const s of sentences) {
    for (const { rx, group } of DEFINITION_PATTERNS) {
      const m = s.text.match(rx);
      if (!m) continue;
      const term = normalizeTerm(m[group] ?? "");
      const key = termKey(term);
      const words = term.split(/\s+/);
      if (!term || key.length < 3 || words.length > 5) continue;
      if (words.every((w) => STOP.has(w.toLowerCase()))) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, definition: s.text, start: s.start });
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}

export function findLists(sentences: Sentence[], max = 8): ReviewerList[] {
  const out: ReviewerList[] = [];
  sentences.forEach((s, i) => {
    if (out.length >= max || !LIST_CUES.test(s.text)) return;
    const items: Sentence[] = [];
    for (const next of sentences.slice(i + 1, i + 12)) {
      if (ITEM_CUES.test(next.text)) items.push(next);
      if (items.length >= 6) break;
    }
    if (items.length >= 2) out.push({ title: s.text, items, start: s.start });
  });
  return out;
}

export function findFacts(sentences: Sentence[], max = 25): Sentence[] {
  return sentences
    .filter((s) => (FACT_YEAR.test(s.text) || FACT_LAW.test(s.text) || FACT_ACRONYM.test(s.text)) && contentWords(s.text).length >= 4)
    .slice(0, max);
}

function buildQuestions(glossary: GlossaryEntry[], lists: ReviewerList[], facts: Sentence[], max = 30): ReviewerQuestion[] {
  const out: ReviewerQuestion[] = [];
  for (const g of glossary.slice(0, 18)) out.push({ question: `What is ${g.term}?`, answer: g.definition, start: g.start });
  for (const l of lists.slice(0, 6)) {
    out.push({ question: `Enumerate: ${clean(l.title).replace(/[.?!]+$/, "")}`, answer: l.items.map((i) => i.text).join(" · "), start: l.start });
  }
  for (const f of facts) {
    const year = f.text.match(FACT_YEAR)?.[1];
    const law = f.text.match(FACT_LAW)?.[0];
    if (law) out.push({ question: `What is ${law}?`, answer: f.text, start: f.start });
    else if (year) out.push({ question: `What happened in ${year}?`, answer: f.text, start: f.start });
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export function buildReviewer(record: StoredTranscript): ReviewerDoc {
  const sentences = toSentences(editedSegments(record));
  const global = keyTerms(sentences);
  const topics = splitTopics(sentences).map((t) => ({ title: t.title, start: t.start, points: pickPoints(t.sentences, global) }));
  const glossary = findDefinitions(sentences);
  const lists = findLists(sentences);
  const facts = findFacts(sentences);
  const questions = buildQuestions(glossary, lists, facts);
  return {
    title: record.title,
    topics: topics.filter((t) => t.points.length > 0),
    glossary,
    lists,
    facts,
    questions,
    thin: sentences.length < 12 || (glossary.length === 0 && lists.length === 0 && facts.length === 0),
  };
}
