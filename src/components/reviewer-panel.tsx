"use client";

import type { ReviewerDoc } from "@/lib/reviewer/build";
import { clock } from "@/lib/transcript/format";

/**
 * The reviewer view: the same recording organised into topics, terms, lists,
 * facts and questions. Every line is quoted from the transcript, and every
 * timestamp jumps the player to the moment it was said.
 */
export function ReviewerPanel({
  doc,
  onSeek,
  canSeek,
  source = "device",
}: {
  doc: ReviewerDoc;
  onSeek: (seconds: number) => void;
  canSeek: boolean;
  /** Which engine organised this doc — the note below must not claim the wrong one. */
  source?: "device" | "ai";
}) {
  const stamp = (at: number) => (
    <button
      onClick={() => onSeek(at)}
      disabled={!canSeek}
      title={canSeek ? "Play from here" : undefined}
      className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted hover:text-accent disabled:hover:text-muted"
    >
      {clock(at)}
    </button>
  );

  if (doc.thin) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        There wasn&apos;t enough spoken material in this recording to organise into a reviewer.
      </p>
    );
  }

  return (
    <div className="space-y-9 pb-8">
      <p className="rounded-xl bg-surface px-4 py-2.5 text-xs leading-relaxed text-muted">
        {source === "ai"
          ? "Organised by AI from this transcript's text, which was sent to OpenRouter. Topic titles and questions are the model's; every quoted line and timestamp still comes straight from your transcript. Your recording never left your device."
          : "Organised on your device from what was said — every line is quoted from the transcript, nothing was added."}{" "}
        Click any timestamp to hear it.
      </p>

      {doc.topics.length > 0 && (
        <section>
          <SectionTitle>Topics</SectionTitle>
          <ol className="space-y-6">
            {doc.topics.map((t, i) => (
              <li key={`${t.start}-${i}`}>
                <div className="flex items-baseline gap-3">
                  {stamp(t.start)}
                  <h3 className="text-base font-semibold">
                    {i + 1}. {t.title}
                  </h3>
                </div>
                <ul className="mt-2 space-y-2">
                  {t.points.map((p, j) => (
                    <li key={`${p.start}-${j}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                      {stamp(p.start)}
                      <span className="text-[15px] leading-relaxed">{p.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {doc.glossary.length > 0 && (
        <section>
          <SectionTitle>Key terms</SectionTitle>
          <dl className="space-y-3">
            {doc.glossary.map((g, i) => (
              <div key={`${g.start}-${i}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                {stamp(g.start)}
                <div>
                  <dt className="font-medium">{g.term}</dt>
                  <dd className="text-[15px] leading-relaxed text-muted">{g.definition}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      )}

      {doc.lists.length > 0 && (
        <section>
          <SectionTitle>Lists to remember</SectionTitle>
          <div className="space-y-4">
            {doc.lists.map((l, i) => (
              <div key={`${l.start}-${i}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                {stamp(l.start)}
                <div>
                  <p className="font-medium">{l.title}</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {l.items.map((it, j) => (
                      <li key={`${it.start}-${j}`} className="flex gap-2 text-[15px] leading-relaxed">
                        <span className="text-muted">•</span>
                        <span>{it.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {doc.facts.length > 0 && (
        <section>
          <SectionTitle>Dates, laws and figures</SectionTitle>
          <ul className="space-y-2">
            {doc.facts.map((f, i) => (
              <li key={`${f.start}-${i}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                {stamp(f.start)}
                <span className="text-[15px] leading-relaxed">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.questions.length > 0 && (
        <section>
          <SectionTitle>Review questions</SectionTitle>
          <p className="-mt-2 mb-3 text-xs text-muted">Answer from memory, then open each one to check.</p>
          <div className="divide-y divide-line/70">
            {doc.questions.map((q, i) => (
              <details key={`${q.start}-${i}`} className="group py-2.5">
                <summary className="cursor-pointer list-none text-[15px] font-medium marker:content-none">
                  <span className="mr-2 text-muted group-open:text-accent">▸</span>
                  {q.question}
                </summary>
                <div className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                  {stamp(q.start)}
                  <p className="text-[15px] leading-relaxed text-muted">{q.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-accent">{children}</h2>;
}
