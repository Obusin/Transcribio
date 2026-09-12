import type { ReviewerDoc, Sentence } from "@/lib/reviewer/build";
import { AI_REVIEWER_SCHEMA, AI_REVIEWER_SYSTEM_PROMPT, planToDoc, type AiReviewerPlan } from "@/lib/reviewer/ai";
import { chat, openRouterConfigured } from "@/server/openrouter";
import { fail, handler, json } from "@/server/http";

/**
 * POST /api/reviewer — build a reviewer with a language model.
 *
 * This is the one part of Transcribio that leaves the device, so it is opt-in
 * per transcript and never runs on its own. The client sends sentence text and
 * timestamps (not the audio, which never leaves the browser at all).
 *
 * The key is server-side; the browser never sees it.
 */

/** Sentences per model call. Long recordings are windowed and the results merged. */
const WINDOW = 220;
/** Hard ceiling so one request cannot run up an unbounded bill. */
const MAX_SENTENCES = 2200;
const MAX_SENTENCE_CHARS = 600;

/** Vercel caps functions well below our 120s client budget unless asked. */
export const maxDuration = 120;

type Body = { title?: unknown; sentences?: unknown };

function parseSentences(raw: unknown): Sentence[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Sentence[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) return null;
    const { text, start } = s as { text?: unknown; start?: unknown };
    if (typeof text !== "string" || typeof start !== "number" || !Number.isFinite(start)) return null;
    const trimmed = text.trim().slice(0, MAX_SENTENCE_CHARS);
    if (trimmed) out.push({ text: trimmed, start });
  }
  return out;
}

/** One model call over one window of sentences, returned in global index space. */
async function planWindow(
  sentences: Sentence[],
  offset: number,
  signal: AbortSignal,
): Promise<AiReviewerPlan> {
  const numbered = sentences.map((s, i) => `${offset + i}\t${s.text}`).join("\n");
  const raw = await chat({
    signal,
    messages: [
      { role: "system", content: AI_REVIEWER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Sentences ${offset}–${offset + sentences.length - 1} of the recording. Each line is "number<TAB>sentence".\n\n${numbered}`,
      },
    ],
    schema: { name: "reviewer_plan", schema: AI_REVIEWER_SCHEMA },
  });

  try {
    return JSON.parse(raw) as AiReviewerPlan;
  } catch {
    // Some providers wrap JSON in prose or a code fence even under json_schema.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The AI reviewer returned something we could not read.");
    return JSON.parse(raw.slice(start, end + 1)) as AiReviewerPlan;
  }
}

function mergePlans(plans: AiReviewerPlan[], fallbackTitle: string): AiReviewerPlan {
  return {
    title: plans.find((p) => p.title?.trim())?.title ?? fallbackTitle,
    // Thin only if every window had nothing to work with.
    thin: plans.every((p) => p.thin),
    topics: plans.flatMap((p) => p.topics ?? []),
    glossary: plans.flatMap((p) => p.glossary ?? []),
    lists: plans.flatMap((p) => p.lists ?? []),
    facts: plans.flatMap((p) => p.facts ?? []),
    questions: plans.flatMap((p) => p.questions ?? []),
  };
}

/**
 * Cost control without accounts.
 *
 * Auth used to be what stopped a stranger burning the OpenRouter balance. With
 * sign-in gone, a per-IP hourly budget takes its place. In-memory, so it resets
 * when the function is recycled and is not shared between regions — enough for
 * a small pilot, not a substitute for a real limiter at scale.
 */
const PER_IP_PER_HOUR = Number(process.env.REVIEWER_HOURLY_LIMIT ?? 12);
const seen = new Map<string, { count: number; resetAt: number }>();

function overBudget(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const hit = seen.get(ip);
  if (!hit || now > hit.resetAt) {
    seen.set(ip, { count: 1, resetAt: now + 3_600_000 });
    if (seen.size > 5000) for (const [k, v] of seen) if (now > v.resetAt) seen.delete(k);
    return false;
  }
  hit.count += 1;
  return hit.count > PER_IP_PER_HOUR;
}

export const POST = handler(
  async (req) => {
  if (!openRouterConfigured()) return fail("AI reviewer is not configured on this server.", 503);
  if (overBudget(req)) return fail("You've used the AI reviewer several times this hour. Try again later, or use the on-device reviewer.", 429);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return fail("Expected a JSON body.", 400);

  const sentences = parseSentences(body.sentences);
  if (!sentences) return fail("Expected sentences as { text, start } objects.", 400);
  if (sentences.length < 4) return fail("There isn't enough spoken material to organise.", 400);
  if (sentences.length > MAX_SENTENCES) {
    return fail(`This recording is too long for the AI reviewer (${sentences.length} sentences, limit ${MAX_SENTENCES}).`, 413);
  }

  const fallbackTitle = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Reviewer";

  // Give up rather than hang if the provider stalls.
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 120_000);
  try {
    const plans: AiReviewerPlan[] = [];
    for (let i = 0; i < sentences.length; i += WINDOW) {
      plans.push(await planWindow(sentences.slice(i, i + WINDOW), i, ac.signal));
    }
    const doc: ReviewerDoc = planToDoc(mergePlans(plans, fallbackTitle), sentences, fallbackTitle);
    return json({ doc });
  } catch (err) {
    if (ac.signal.aborted) return fail("The AI reviewer timed out. Try again, or use the on-device reviewer.", 504);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  },
  // Open: this deployment has no accounts. The per-IP budget above is the guard.
  { auth: false },
);
