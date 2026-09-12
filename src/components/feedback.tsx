"use client";

import { useState } from "react";
import { pilotCode, setPilotCode, setTelemetryOff, telemetryOff, track } from "@/lib/telemetry";

/**
 * Pilot feedback widget.
 *
 * The quantitative side of the pilot comes from events; this is the qualitative
 * side — a persistent way for a chosen tester to say "this broke" or "this was
 * confusing" at the moment it happens, rather than remembering it later.
 *
 * It also carries the honest disclosure and the opt-out, because a product that
 * sells on privacy cannot collect usage stats silently.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [code, setCode] = useState(() => pilotCode() ?? "");
  const [off, setOff] = useState(() => telemetryOff());

  const send = () => {
    if (!message.trim()) return;
    if (code.trim()) setPilotCode(code);
    track("feedback", { message: message.trim(), rating: rating ?? undefined, pilot: code.trim() || undefined });
    setSent(true);
    setMessage("");
    setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 1800);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-11 rounded-full bg-deep px-5 text-sm font-bold text-white shadow-float transition hover:bg-deeper"
      >
        Give feedback
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(22rem,calc(100vw-2.5rem))] rounded-panel border border-line bg-surface p-5 shadow-float">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-extrabold tracking-[-0.02em]">How did that go?</p>
        <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-ink">
          ✕
        </button>
      </div>

      {sent ? (
        <p className="mt-4 text-sm text-muted">Sent. Thank you — this is genuinely useful.</p>
      ) : (
        <>
          <div className="mt-3 flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n} out of 5`}
                className={`h-8 w-8 rounded-full border text-xs font-bold transition ${
                  rating === n ? "border-accent bg-accent text-accent-ink" : "border-line hover:border-ink"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="What worked, what didn't, what you expected instead…"
            className="mt-3 w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
          />

          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Tester code (if you were given one)"
            className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-ink"
          />

          <button
            onClick={send}
            disabled={!message.trim()}
            className="mt-3 h-10 w-full rounded-full bg-accent text-sm font-bold text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            Send feedback
          </button>

          <label className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={!off}
              onChange={(e) => {
                setTelemetryOff(!e.target.checked);
                setOff(!e.target.checked);
              }}
              className="mt-0.5"
            />
            <span>
              Share anonymous usage stats — speed, device type, errors, which exports you use.{" "}
              <strong className="font-semibold text-ink">Never your recording, transcript or file names.</strong>
            </span>
          </label>
        </>
      )}
    </div>
  );
}
