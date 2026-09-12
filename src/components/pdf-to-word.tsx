"use client";

import { useRef, useState } from "react";
import { convertedExportDoc } from "@/lib/convert/document";
import { extractPdf, NoTextLayerError, type ConvertedPdf, type PdfjsLike } from "@/lib/convert/pdf-text";
import { exportFileName } from "@/lib/transcript/document";

type State =
  | { name: "idle" }
  | { name: "reading"; file: File; done: number; total: number }
  | { name: "ready"; file: File; pdf: ConvertedPdf }
  | { name: "error"; message: string };

export function PdfToWord() {
  const [state, setState] = useState<State>({ name: "idle" });
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const convert = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setState({ name: "error", message: "That isn't a PDF. Choose a .pdf file." });
      return;
    }
    setState({ name: "reading", file, done: 0, total: 0 });
    try {
      // pdf.js is ~1 MB; load it only when someone actually converts something.
      const pdfjs = (await import("pdfjs-dist")) as unknown as PdfjsLike & { GlobalWorkerOptions: { workerSrc: string } };
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await extractPdf(pdfjs, data, {
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        cMapUrl: "/pdfjs/cmaps/",
        onPage: (done, total) => setState((s) => (s.name === "reading" ? { ...s, done, total } : s)),
      });
      setState({ name: "ready", file, pdf });
    } catch (err) {
      setState({ name: "error", message: friendly(err) });
    }
  };

  const download = async () => {
    if (state.name !== "ready") return;
    setSaving(true);
    try {
      const doc = convertedExportDoc(state.file.name, state.pdf);
      const blob = await (await import("@/lib/transcript/render-docx")).renderDocx(doc);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportFileName(doc.title, "docx");
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      setState({ name: "error", message: `Couldn't create the Word document: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const preview = state.name === "ready" ? state.pdf.pages.flatMap((p) => p.blocks).slice(0, 6) : [];

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-20 pt-4">
      <h1 className="text-2xl font-semibold tracking-tight">PDF to Word</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Turn a PDF into an editable Word document (.docx, also opens in Google Docs). The file is read on your device —
        nothing is uploaded.
      </p>

      {state.name === "idle" && (
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
            if (f) void convert(f);
          }}
          className={`mt-8 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
            over ? "border-accent bg-accent-soft" : "border-line bg-surface"
          }`}
        >
          <p className="text-lg font-medium">Drop your PDF here</p>
          <p className="mt-1 text-sm text-muted">Text-based PDFs — reports, handouts, articles</p>
          <button
            onClick={() => input.current?.click()}
            className="mt-6 h-11 rounded-full bg-accent px-6 text-sm font-medium text-accent-ink transition hover:opacity-90"
          >
            Choose PDF
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void convert(f);
            }}
          />
          <p className="mt-6 text-xs text-muted">Your file stays on your device. Nothing is uploaded.</p>
        </div>
      )}

      {state.name === "reading" && (
        <section className="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <p className="truncate text-sm text-muted">{state.file.name}</p>
          <h2 className="mb-6 mt-1 text-xl font-semibold tracking-tight">Reading the PDF…</h2>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${state.total ? Math.round((100 * state.done) / state.total) : 5}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted">
            {state.total ? `Page ${state.done} of ${state.total}` : "Opening…"}
          </p>
        </section>
      )}

      {state.name === "ready" && (
        <section className="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <p className="truncate text-sm text-muted">{state.file.name}</p>
          <h2 className="mb-6 mt-1 text-xl font-semibold tracking-tight">Ready to save</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">Pages</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{state.pdf.pages.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Words</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{state.pdf.wordCount.toLocaleString()}</dd>
            </div>
          </dl>

          <div className="mt-6 max-h-64 overflow-y-auto rounded-xl bg-paper p-4 text-sm leading-relaxed">
            {preview.map((b, i) =>
              b.kind === "heading" ? (
                <p key={i} className="mb-2 font-semibold">
                  {b.text}
                </p>
              ) : (
                <p key={i} className="mb-2 text-muted">
                  {b.text.slice(0, 300)}
                  {b.text.length > 300 ? "…" : ""}
                </p>
              ),
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              onClick={() => void download()}
              disabled={saving}
              className="h-11 flex-1 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Preparing…" : "Download Word document"}
            </button>
            <button
              onClick={() => setState({ name: "idle" })}
              className="h-11 rounded-full border border-line px-5 text-sm hover:border-ink"
            >
              Convert another
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Text, headings and paragraphs carry over. Exact page layout — columns, tables and images — does not.
          </p>
        </section>
      )}

      {state.name === "error" && (
        <section className="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Couldn&apos;t convert this PDF</h2>
          <p className="text-sm leading-relaxed text-danger">{state.message}</p>
          <button
            onClick={() => setState({ name: "idle" })}
            className="mt-5 h-10 rounded-full border border-line px-5 text-sm hover:border-ink"
          >
            Try another file
          </button>
        </section>
      )}
    </div>
  );
}

function friendly(err: unknown): string {
  if (err instanceof NoTextLayerError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/password/i.test(msg)) return "This PDF is password-protected. Open it with the password and save an unlocked copy first.";
  if (/Invalid PDF|corrupt|structure/i.test(msg)) return "This file doesn't look like a readable PDF — it may be damaged.";
  return msg;
}
