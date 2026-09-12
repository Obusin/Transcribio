"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { setPendingFile } from "@/lib/marketing/handoff";

/**
 * The tool card that sits above the fold on every funnel page.
 *
 * TurboScribe's funnel works because the tool is the hero: you are doing the job
 * before you have been asked for anything. This is the same idea — a real drop
 * target, not a picture of one. Dropping a file hands it to the app through an
 * in-memory handoff and navigates there, so a signed-in visitor goes straight to
 * the setup screen with their file already chosen.
 */
export function ToolCard({
  dropLabel,
  formats,
  cta = "Transcribe",
}: {
  dropLabel: string;
  formats: string;
  cta?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [going, setGoing] = useState(false);

  const go = (f: File | null) => {
    if (f) setPendingFile(f);
    setGoing(true);
    router.push("/transcribe");
  };

  return (
    <div className="w-full rounded-panel border border-line bg-surface p-5 shadow-float sm:p-6">
      <p className="mb-3 text-sm font-semibold text-ink">{dropLabel}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) {
            setFile(f);
            go(f);
          }
        }}
        className={`flex flex-col items-center justify-center rounded-card border-2 border-dashed px-5 py-10 text-center transition-colors ${
          over ? "border-accent bg-accent-soft" : "border-line-strong bg-panel-alt"
        }`}
      >
        <p className="text-base font-semibold text-ink">Drag &amp; drop</p>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted">{formats}</p>

        <p className="eyebrow my-4 text-label">— or —</p>

        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-5 text-[13px] font-bold tracking-[-0.02em] text-ink transition hover:border-ink"
        >
          Browse files
        </button>

        <input
          ref={input}
          type="file"
          accept="audio/*,video/*,.mkv,.mov"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              setFile(f);
              go(f);
            }
          }}
        />
      </div>

      {file && (
        <p className="mt-3 truncate text-xs text-muted" title={file.name}>
          Selected: <span className="font-medium text-ink">{file.name}</span>
        </p>
      )}

      <button
        type="button"
        disabled={going}
        onClick={() => go(file)}
        className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full bg-deep px-6 text-sm font-bold tracking-[-0.02em] text-white transition hover:bg-deeper disabled:opacity-60"
      >
        {going ? "Opening…" : cta}
      </button>

      <p className="mt-3 text-center text-xs leading-relaxed text-muted">
        Runs on your device. Nothing is uploaded. If you are not signed in yet you will be asked to first, and
        you will need to pick the file again after.
      </p>
    </div>
  );
}
