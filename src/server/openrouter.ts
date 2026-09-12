import "server-only";

/**
 * OpenRouter client.
 *
 * The API key lives only here, on the server. It is read from OPENROUTER_API_KEY
 * and must never be given a NEXT_PUBLIC_ prefix — a key shipped to the browser is
 * a key handed to every visitor.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Overridable so the model can be changed without a code edit. */
export const REVIEWER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export type ChatMessage = { role: "system" | "user"; content: string };

/**
 * Sends a chat completion and returns the raw assistant text.
 * `schema` switches on structured output so the reply parses reliably.
 */
export async function chat(opts: {
  messages: ChatMessage[];
  schema?: { name: string; schema: unknown };
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError("AI reviewer is not configured on this server.", 503);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      // OpenRouter uses these for attribution on their dashboard.
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
      "X-Title": "Transcribio",
    },
    body: JSON.stringify({
      model: REVIEWER_MODEL,
      messages: opts.messages,
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? Number(process.env.OPENROUTER_MAX_TOKENS ?? 3000),
      ...(opts.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema },
            },
          }
        : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Never surface the upstream body verbatim — it can echo request details.
    const detail = res.status === 401 ? "The AI provider rejected our credentials." : "The AI provider returned an error.";
    console.error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
    throw new OpenRouterError(detail, res.status === 429 ? 429 : 502);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error) throw new OpenRouterError(data.error.message ?? "The AI provider returned an error.", 502);

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new OpenRouterError("The AI provider returned an empty reply.", 502);
  return text;
}
