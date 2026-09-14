"use client";

import { useState } from "react";
import { buildContribution, ERROR_KINDS, type ErrorKind } from "@/lib/contribution";
import { localDeviceId } from "@/lib/deployment";
import { pilotCode, track } from "@/lib/telemetry";
import type { StoredTranscript } from "@/lib/transcript/store";

interface Saved {
  rating: number;
  shared: boolean;
  /** Fingerprint of the edits that were shared, to offer re-sending after more corrections. */
  editsKey?: string;
}

const key = (id: string) => `transcribio.rated.${id}`;
const editsKey = (r: StoredTranscript) => JSON.stringify(r.edits);

function readSaved(id: string): Saved | null {
  try {
    const v = localStorage.getItem(key(id));
    return v ? (JSON.parse(v) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(id: string, s: Saved) {
  try {
    localStorage.setItem(key(id), JSON.stringify(s));
  } catch {
    /* storage blocked — the card will just ask again next time */
  }
}

/**
 * "How accurate was this?" — shown on every finished transcript.
 *
 * The rating and mistake kinds are content-free and always sent. Sharing the
 * transcript itself is a separate, unticked box with a plain statement of what
 * goes and what doesn't; nothing is shared unless the user ticks it.
 */
export function RatingCard({ record }: { record: StoredTranscript }) {
  const [saved, setSaved] = useState<Saved | null>(() => readSaved(record.id));
  const [rating, setRating] = useState<number | null>(null);
  const [errors, setErrors] = useState<ErrorKind[]>([]);
  const [comment, setComment] = useState("");
  const [share, setShare] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const sendShare = async (answers: { rating: number; errors: ErrorKind[]; comment?: string }) => {
    const res = await fetch("/api/contribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contribution: buildContribution(record, answers),
        device: localDeviceId(),
        pilot: pilotCode() ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Couldn't share right now.");
    }
  };

  const submit = async () => {
    if (!rating) return;
    setState("sending");
    setMessage(null);
    const answers = { rating, errors, comment: comment.trim() || undefined };
    track("transcript_rated", {
      rating,
      errors: errors.join(","),
      shared: share,
      durationSeconds: record.raw.durationSeconds,
      language: record.raw.detectedLanguages.join(","),
      modelId: record.raw.modelId,
      ...(comment.trim() ? { message: comment.trim() } : {}),
    });
    try {
      if (share) await sendShare(answers);
      const next: Saved = { rating, shared: share, ...(share ? { editsKey: editsKey(record) } : {}) };
      writeSaved(record.id, next);
      setSaved(next);
      setState("idle");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Couldn't share right now.");
    }
  };

  // Already answered for this transcript.
  if (saved) {
    const moreCorrections = saved.shared && saved.editsKey !== editsKey(record);
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="font-medium">Thanks for rating this transcript.</p>
        <p className="mt-1 text-xs text-muted">
          {saved.shared
            ? "You shared it to help improve Transcribio — thank you."
            : "Your rating helps us see where it goes wrong."}
        </p>
        {moreCorrections && (
          <button
            disabled={state === "sending"}
            onClick={async () => {
              setState("sending");
              try {
                await sendShare({ rating: saved.rating, errors: [] });
                const next = { ...saved, editsKey: editsKey(record) };
                writeSaved(record.id, next);
                setSaved(next);
                setState("idle");
              } catch (err) {
                setState("error");
                setMessage(err instanceof Error ? err.message : "Couldn't share right now.");
              }
            }}
            className="mt-3 h-8 rounded-full border border-line px-3.5 text-xs font-medium hover:border-ink disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : "You've fixed more lines — send the updated version"}
          </button>
        )}
        {message && <p className="mt-2 text-xs text-danger">{message}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
      <p className="font-medium">How accurate was this transcript?</p>
      <p className="mt-0.5 text-xs text-muted">It&apos;s a free beta — this is the most useful thing you can tell us.</p>

      <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Accuracy rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            onClick={() => setRating(n)}
            className={`h-9 w-9 rounded-full border text-sm font-semibold transition ${
              rating === n ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface hover:border-ink"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted" style={{ width: "13.5rem" }}>
        <span>Many mistakes</span>
        <span>Perfect</span>
      </div>

      {rating != null && (
        <>
          {rating < 5 && (
            <>
              <p className="mt-4 text-xs font-medium">What went wrong? (tick any)</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ERROR_KINDS.map((k) => {
                  const on = errors.includes(k.id);
                  return (
                    <button
                      key={k.id}
                      aria-pressed={on}
                      onClick={() => setErrors((e) => (on ? e.filter((x) => x !== k.id) : [...e, k.id]))}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface hover:border-ink"
                      }`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Anything else? (optional)"
            className="mt-3 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-ink"
          />

          <label className="mt-3 flex items-start gap-2 rounded-xl bg-surface p-3 text-xs leading-relaxed">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-0.5" />
            <span>
              <strong className="font-semibold">Share this transcript to help improve Transcribio.</strong>
              <span className="mt-1 block text-muted">
                Sends the transcript&apos;s text, your corrections and the language — so we can see exactly what it
                got wrong. <strong className="font-semibold text-ink">Never the audio or video, and never the file name.</strong>{" "}
                Only tick this if the recording isn&apos;t private.
              </span>
            </span>
          </label>

          {share && record.edits && Object.keys(record.edits).length === 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Tip: click any wrong line in the transcript and fix it first — corrections make your share far more
              useful.
            </p>
          )}

          <button
            onClick={() => void submit()}
            disabled={state === "sending"}
            className="mt-3 h-9 w-full rounded-full bg-accent text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          >
            {state === "sending" ? "Sending…" : share ? "Send rating & share" : "Send rating"}
          </button>
          {message && <p className="mt-2 text-xs text-danger">{message}</p>}
        </>
      )}
    </div>
  );
}
