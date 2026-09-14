"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RatingCard } from "@/components/rating-card";
import { ReviewerPanel } from "@/components/reviewer-panel";
import { getModel } from "@/lib/engine/models";
import { ACCOUNTS_ENABLED } from "@/lib/deployment";
import { track } from "@/lib/telemetry";
import { buildReviewer, toSentences, type ReviewerDoc } from "@/lib/reviewer/build";
import { reviewerExportDoc } from "@/lib/reviewer/document";
import { partAt } from "@/lib/transcript/combine";
import { buildExportDoc, exportFileName } from "@/lib/transcript/document";
import { clock, exportTranscript, type ExportFormat } from "@/lib/transcript/format";
import { account, persist } from "@/lib/transcript/account-sync";
import { editedSegments, type StoredTranscript } from "@/lib/transcript/store";

const LANG_NAME: Record<string, string> = { en: "English", tl: "Filipino/Taglish" };

export function TranscriptEditor({
  record: initial,
  file,
  onAttachFile,
  onNewFile,
  onTranscribeAgain,
  onContinue,
  onBack,
}: {
  record: StoredTranscript;
  file: File | null;
  onAttachFile: (f: File) => void;
  /** Start a transcription of a different file. */
  onNewFile: (f: File) => void;
  /** Re-run this recording from the start (e.g. with other settings). */
  onTranscribeAgain: (f: File) => void;
  /** Resume a partial transcript where it stopped; receives the latest record (with edits). */
  onContinue: (record: StoredTranscript, f: File) => void;
  onBack: () => void;
}) {
  const [record, setRecord] = useState(initial);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"transcript" | "reviewer">("transcript");
  // The AI reviewer is opt-in per transcript: null until the user asks for it.
  // Tagged with the record id so switching transcripts drops it without an effect.
  const [ai, setAi] = useState<{ id: string; doc: ReviewerDoc } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "confirm" | "working">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  // Hidden unless the server has a key, so testers never see a button that can only fail.
  const [aiEnabled, setAiEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/reviewer")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => alive && setAiEnabled(Boolean(d.enabled)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [active, setActive] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef<"new" | "again" | "continue">("new");
  const rows = useRef(new Map<number, HTMLDivElement>());

  const segments = useMemo(() => editedSegments(record), [record]);
  const localReviewer = useMemo(() => buildReviewer(record), [record]);
  const aiDoc = ai && ai.id === record.id ? ai.doc : null;
  const reviewer = aiDoc ?? localReviewer;

  const runAiReviewer = async () => {
    setAiState("working");
    setAiError(null);
    try {
      const res = await fetch("/api/reviewer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: record.title, sentences: toSentences(segments) }),
      });
      const data = (await res.json()) as { doc?: ReviewerDoc; error?: string };
      if (!res.ok) throw new Error(data.error ?? "The AI reviewer failed.");
      if (!data.doc) throw new Error("The AI reviewer returned nothing.");
      setAi({ id: record.id, doc: data.doc });
      track("ai_reviewer_used", { durationSeconds: record.raw.durationSeconds });
      setAiState("idle");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
      setAiState("idle");
    }
  };
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;
  }, [segments, query]);

  // Attach the local file to the player. Creating and revoking the blob URL in
  // one effect keeps StrictMode's effect replay from revoking a URL in use.
  const src = file !== null;
  useEffect(() => {
    const el = media.current;
    if (!el || !file) return;
    const url = URL.createObjectURL(file);
    el.src = url;
    return () => {
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const [sync, setSync] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  const save = async (next: StoredTranscript) => {
    const withTime = { ...next, updatedAt: new Date().toISOString() };
    setRecord(withTime);
    if (withTime.savedToAccount) setSync({ state: "saving" });
    const r = await persist(withTime);
    if (withTime.savedToAccount) setSync(r.synced ? { state: "saved" } : { state: "error", message: r.error });
  };
  const setSavedToAccount = async (on: boolean) => {
    if (on) return save({ ...record, savedToAccount: true });
    if (!confirm("Remove this transcript from your account? It stays in this browser.")) return;
    setSync({ state: "saving" });
    try {
      await account.remove(record.id);
    } catch (err) {
      setSync({ state: "error", message: (err as Error).message });
      return;
    }
    setSync({ state: "idle" });
    await save({ ...record, savedToAccount: false });
  };

  // Media → transcript: highlight the line being spoken and keep it in view.
  const onTimeUpdate = () => {
    const t = media.current?.currentTime ?? 0;
    const seg = segments.find((s, i) => t >= s.start && t < (segments[i + 1]?.start ?? s.end + 1));
    const id = seg?.id ?? null;
    if (id !== active) {
      setActive(id);
      if (id != null && editing == null) rows.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // Transcript → media: clicking a timestamp seeks.
  const seek = (t: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = t;
    void m.play();
  };

  const parts = record.parts;
  /** Combined transcripts show time within each original recording: "2 · 10:50". */
  const stamp = (seconds: number) => {
    if (!parts?.length) return clock(seconds);
    const { index, part } = partAt(parts, seconds);
    return `${index + 1} · ${clock(seconds - part.offsetSeconds)}`;
  };
  const firstOfPart = useMemo(() => {
    const firsts = new Map<number, number>(); // segment id → part index
    if (!parts?.length) return firsts;
    const seen = new Set<number>();
    for (const s of segments) {
      const { index } = partAt(parts, s.start);
      if (!seen.has(index)) {
        seen.add(index);
        firsts.set(s.id, index);
      }
    }
    return firsts;
  }, [parts, segments]);

  const saveBlob = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const download = async (format: ExportFormat | "pdf" | "docx") => {
    track("exported", { format, durationSeconds: record.raw.durationSeconds });
    setExportError(null);
    if (format === "txt" || format === "srt" || format === "vtt") {
      const { body, mime } = exportTranscript(segments, format, parts);
      return saveBlob(new Blob([body], { type: `${mime};charset=utf-8` }), exportFileName(record.title, format));
    }
    // Document exports are built in the browser; their libraries load only when needed.
    setExporting(format);
    try {
      const doc = view === "reviewer" ? reviewerExportDoc(record, reviewer) : buildExportDoc(record);
      const blob =
        format === "pdf"
          ? await (await import("@/lib/transcript/render-pdf")).renderPdfInBrowser(doc)
          : await (await import("@/lib/transcript/render-docx")).renderDocx(doc);
      saveBlob(blob, exportFileName(doc.title, format));
    } catch (err) {
      setExportError(`Couldn't create the ${format === "pdf" ? "PDF" : "Word document"}: ${(err as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  const t = record.raw;
  const editedCount = Object.keys(record.edits).length;

  /** Run `purpose` with the recording's file — asking for it if it isn't attached. */
  const withFile = (purpose: "new" | "again" | "continue") => {
    if (purpose !== "new" && file) return dispatch(purpose, file);
    pickFor.current = purpose;
    picker.current?.click();
  };
  const dispatch = (purpose: "new" | "again" | "continue", f: File) => {
    if (purpose === "new") return onNewFile(f);
    if (
      f.size !== record.fileSize &&
      !confirm(`“${f.name}” doesn't look like the original recording (${record.fileName}). Use it anyway?`)
    ) {
      return;
    }
    if (purpose === "again") onTranscribeAgain(f);
    else onContinue(record, f);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onBack} className="text-sm text-muted hover:text-ink">
            ← All transcripts
          </button>
          <input
            value={record.title}
            onChange={(e) => setRecord({ ...record, title: e.target.value })}
            onBlur={() => save(record)}
            className="min-w-0 rounded-md bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:bg-surface focus:bg-surface focus:ring-1 focus:ring-line"
            aria-label="Transcript title"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => withFile("new")}
            className="mr-3 h-8 rounded-full bg-accent px-4 text-xs font-medium text-accent-ink hover:opacity-90"
          >
            + New transcription
          </button>
          <input
            ref={picker}
            type="file"
            accept="audio/*,video/*,.mkv,.mov"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) dispatch(pickFor.current, f);
            }}
          />
          <span className="mr-1 text-xs text-muted">Export</span>
          {(
            [
              { f: "pdf", label: "PDF", title: "PDF document" },
              { f: "docx", label: "Word", title: "Word document (.docx) — also opens in Google Docs" },
              { f: "txt", label: "TXT", title: "Plain text" },
              { f: "srt", label: "SRT", title: "Subtitles (SRT)" },
              { f: "vtt", label: "VTT", title: "Subtitles (WebVTT)" },
            ] as const
          ).map(({ f, label, title }) => (
            <button
              key={f}
              title={title}
              disabled={exporting !== null}
              onClick={() => void download(f)}
              className="h-8 rounded-full border border-line bg-surface px-3.5 text-xs font-medium hover:border-ink disabled:opacity-50"
            >
              {exporting === f ? "Preparing…" : label}
            </button>
          ))}
        </div>
      </div>

      {exportError && <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-danger">{exportError}</p>}
      {t.partial && !parts && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          <span>
            Partial transcript — stopped at {clock(t.partial.stoppedAtSeconds)} of {clock(t.durationSeconds)}.
          </span>
          <button
            onClick={() => withFile("continue")}
            className="h-8 rounded-full bg-accent px-4 text-xs font-medium text-accent-ink hover:opacity-90"
          >
            Continue from {clock(t.partial.stoppedAtSeconds)}
          </button>
        </div>
      )}
      {t.unreadable && t.unreadable.length > 0 && (
        <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Part of this recording was damaged and couldn&apos;t be read, so it isn&apos;t in the transcript:{" "}
          {t.unreadable
            .slice(0, 5)
            .map((u) => `${stamp(u.start)}–${clock(u.end - (parts ? partAt(parts, u.start).part.offsetSeconds : 0))}`)
            .join(", ")}
          {t.unreadable.length > 5 ? ` and ${t.unreadable.length - 5} more` : ""}.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="sticky top-0 z-10 -mx-1 bg-paper px-1 pb-4 pt-1">
            {parts ? (
              <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="text-muted">
                  Combines {parts.length} recordings. Timestamps show <b className="font-medium text-ink">part · time in that recording</b>;
                  open a single recording to play it alongside its lines.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {parts.map((p, i) => (
                    <a
                      key={p.sourceId + i}
                      href={`#part-${i + 1}`}
                      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink no-underline hover:border-ink"
                    >
                      {i + 1} · {p.title} · {clock(p.durationSeconds)}
                    </a>
                  ))}
                </div>
              </div>
            ) : src ? (
              record.hasVideo ? (
                <video
                  ref={media}
                  controls
                  onTimeUpdate={onTimeUpdate}
                  className="max-h-[38vh] w-full rounded-xl bg-black"
                />
              ) : (
                <audio ref={media} controls onTimeUpdate={onTimeUpdate} className="w-full" />
              )
            ) : (
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted hover:border-ink">
                <span>
                  Media isn&apos;t stored — attach <span className="font-medium text-ink">{record.fileName}</span> to play it
                  alongside the transcript.
                </span>
                <span className="font-medium text-ink">Choose file</span>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onAttachFile(e.target.files[0])}
                />
              </label>
            )}
            <div className="mt-3 flex w-fit gap-1 rounded-full border border-line bg-surface p-1">
              {(
                [
                  ["transcript", "Transcript"],
                  ["reviewer", "Reviewer"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    if (v === "reviewer") track("reviewer_opened");
                  }}
                  className={`h-7 rounded-full px-3.5 text-xs font-medium ${
                    view === v ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "transcript" && (
              <p className="mt-1.5 text-xs text-muted">
                Spotted a mistake? <strong className="font-medium text-ink">Click any line to fix it</strong> — your
                changes save automatically and the original is kept.
              </p>
            )}
            {view === "reviewer" && (
              <>
                <p className="mt-1.5 text-xs text-muted">PDF and Word export the reviewer while this view is open.</p>
                {aiEnabled && (
                <AiReviewerControl
                  state={aiState}
                  active={aiDoc !== null}
                  error={aiError}
                  onAsk={() => setAiState("confirm")}
                  onCancel={() => setAiState("idle")}
                  onConfirm={() => void runAiReviewer()}
                  onRevert={() => {
                    setAi(null);
                    setAiError(null);
                  }}
                />
                )}
              </>
            )}
          </div>

          {view === "reviewer" && <ReviewerPanel doc={reviewer} onSeek={seek} canSeek={src && !parts} source={aiDoc ? "ai" : "device"} />}

          {view === "transcript" && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              {segments.length === 0 ? "No speech was detected in this recording." : `No lines match “${query}”.`}
            </p>
          )}
          <div className={view === "transcript" ? "divide-y divide-line/70" : "hidden"}>
            {visible.map((s) => (
              <div key={s.id}>
              {parts && !query && firstOfPart.has(s.id) && (() => {
                const i = firstOfPart.get(s.id)!;
                const p = parts[i];
                return (
                  <div id={`part-${i + 1}`} className="scroll-mt-4 px-2 pb-2 pt-6">
                    <div className="text-xs font-medium uppercase tracking-wider text-accent">Part {i + 1}</div>
                    <div className="text-base font-semibold">{p.title}</div>
                    <div className="text-xs text-muted">
                      {clock(p.durationSeconds)}
                      {p.recordedAt ? ` · recorded ${p.recordedAt.replace("T", " ")}` : ""}
                      {p.partial ? " · partial" : ""}
                    </div>
                  </div>
                );
              })()}
              <div
                ref={(el) => {
                  if (el) rows.current.set(s.id, el);
                  else rows.current.delete(s.id);
                }}
                className={`group grid ${parts ? "grid-cols-[96px_minmax(0,1fr)]" : "grid-cols-[64px_minmax(0,1fr)]"} gap-3 rounded-lg px-2 py-2.5 transition-colors ${
                  active === s.id ? "bg-accent-soft" : ""
                }`}
              >
                <button
                  onClick={() => seek(s.start)}
                  disabled={!src || !!parts}
                  className="whitespace-nowrap pt-0.5 text-left font-mono text-xs tabular-nums text-muted hover:text-accent disabled:hover:text-muted"
                  title={src && !parts ? "Play from here" : undefined}
                >
                  {stamp(s.start)}
                </button>
                <div
                  // Remount when the text changes so React and the edited DOM never disagree.
                  key={s.text}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onFocus={() => setEditing(s.id)}
                  onBlur={(e) => {
                    setEditing(null);
                    const text = e.currentTarget.textContent?.trim() ?? "";
                    const raw = t.segments.find((r) => r.id === s.id)?.text ?? "";
                    const edits = { ...record.edits };
                    if (text === raw) delete edits[s.id];
                    else edits[s.id] = text;
                    if (JSON.stringify(edits) !== JSON.stringify(record.edits)) void save({ ...record, edits });
                  }}
                  title="Click to fix this line"
                  className="cursor-text rounded px-1 text-[15px] leading-relaxed outline-none transition-colors hover:bg-surface hover:ring-1 hover:ring-line focus:bg-surface focus:ring-1 focus:ring-accent"
                >
                  {s.text}
                </div>
              </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-5 text-sm lg:sticky lg:top-4 lg:self-start">
          {/* Keyed by transcript so switching recordings starts a fresh rating. */}
          <RatingCard key={record.id} record={record} />
          {view === "transcript" && (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcript"
                className="h-10 w-full rounded-xl border border-line bg-surface px-3.5 outline-none placeholder:text-muted focus:border-ink"
              />
              {query && (
                <p className="-mt-3 text-xs text-muted">
                  {visible.length} of {segments.length} lines
                </p>
              )}
            </>
          )}
          <dl className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <Row
              label="Length"
              value={t.partial ? `${clock(t.partial.stoppedAtSeconds)} of ${clock(t.durationSeconds)}` : clock(t.durationSeconds)}
            />
            {parts && <Row label="Parts" value={`${parts.length} recordings`} />}
            <Row label="Language" value={t.detectedLanguages.map((l) => LANG_NAME[l] ?? l).join(", ") || "—"} />
            <Row label="Model" value={safeModelName(t.modelId)} />
            <Row label="Processed" value={`Locally · ${t.stats.realtimeFactor.toFixed(1)}× realtime`} />
            <Row label="Edits" value={editedCount ? `${editedCount} line${editedCount > 1 ? "s" : ""}` : "None"} />
          </dl>
          {ACCOUNTS_ENABLED && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="save-label" className="font-medium">Save to my account</p>
                <p className="mt-0.5 text-xs text-muted">
                  {record.savedToAccount
                    ? "Kept in your account too — safe if this browser is cleared, and there when you sign in elsewhere. Edits sync automatically."
                    : "Only in this browser right now."}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={!!record.savedToAccount}
                aria-labelledby="save-label"
                disabled={sync.state === "saving"}
                onClick={() => void setSavedToAccount(!record.savedToAccount)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${record.savedToAccount ? "bg-accent" : "bg-line"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${record.savedToAccount ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            {sync.state !== "idle" && (
              <p className={`mt-2 text-xs ${sync.state === "error" ? "text-danger" : "text-muted"}`}>
                {sync.state === "saving" ? "Saving to your account…" : sync.state === "saved" ? "Saved to your account." : `Couldn't save to your account: ${sync.message}`}
              </p>
            )}
          </div>
          )}
          {editedCount > 0 && (
            <button
              onClick={() => confirm("Discard all edits and restore the original transcript?") && save({ ...record, edits: {} })}
              className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Restore original transcript
            </button>
          )}
          {!parts && <div>
            <button
              onClick={() => withFile("again")}
              className="h-9 w-full rounded-full border border-line bg-surface text-xs font-medium hover:border-ink"
            >
              Transcribe again
            </button>
            <p className="mt-1.5 text-xs text-muted">Re-run this recording with a different language or performance setting.</p>
          </div>}
          <p className="text-xs leading-relaxed text-muted">
            Click a timestamp to play from that point. Click any line to correct it — the original transcript is
            always kept.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function safeModelName(id: string) {
  try {
    return getModel(id).name;
  } catch {
    return id;
  }
}

/**
 * Opt-in control for the AI reviewer.
 *
 * Everything else in Transcribio runs on the device. This one feature does not,
 * so it asks first and says exactly what leaves: the transcript text, never the
 * recording. Declining leaves the on-device reviewer in place, which is the
 * default and always available.
 */
function AiReviewerControl({
  state,
  active,
  error,
  onAsk,
  onCancel,
  onConfirm,
  onRevert,
}: {
  state: "idle" | "confirm" | "working";
  active: boolean;
  error: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRevert: () => void;
}) {
  if (state === "working") {
    return (
      <p className="mt-2 text-xs text-muted">Organising with AI — this takes a few seconds per hour of audio…</p>
    );
  }

  if (state === "confirm") {
    return (
      <div className="mt-2 max-w-lg rounded-xl border border-warn/40 bg-warn-soft px-4 py-3">
        <p className="text-xs font-semibold text-ink">This one sends your transcript off your device.</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          The <strong>text</strong> of this transcript is sent to OpenRouter to be organised. Your recording is
          never sent — audio and video stay on your machine as always. Don&apos;t use this for material you
          can&apos;t share with a third party; the on-device reviewer covers that case with no network at all.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onConfirm}
            className="h-8 rounded-full bg-accent px-4 text-xs font-medium text-accent-ink hover:opacity-90"
          >
            Send transcript &amp; organise
          </button>
          <button onClick={onCancel} className="h-8 rounded-full border border-line px-4 text-xs font-medium hover:border-ink">
            Keep it on-device
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {active ? (
        <button onClick={onRevert} className="text-xs font-medium text-accent hover:underline">
          ← Back to the on-device reviewer
        </button>
      ) : (
        <button onClick={onAsk} className="text-xs font-medium text-accent hover:underline">
          Organise with AI instead (sends the transcript text off your device)
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
