"use client";

import { useEffect, useRef, useState } from "react";
import { classifyLink, importFromLink, LinkImportError, platformMessage } from "@/lib/link-import";
import { track } from "@/lib/telemetry";

type State =
  | { name: "idle" }
  | { name: "downloading"; loaded: number; total: number | null }
  | { name: "error"; message: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * "Paste a link" — downloads a public audio/video link into the browser and hands
 * it to the normal file flow. `initialUrl` starts an import immediately (used
 * when a landing page hands a link over).
 */
export function LinkImportBox({
  onFile,
  disabled,
  initialUrl,
}: {
  onFile: (f: File) => void;
  disabled?: boolean;
  initialUrl?: string | null;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<State>({ name: "idle" });
  const abort = useRef<AbortController | null>(null);

  const run = async (link: string) => {
    const plan = classifyLink(link);
    if (plan.kind === "invalid") return setState({ name: "error", message: plan.reason });
    if (plan.kind === "platform") {
      track("link_imported", { source: "platform-refused", error: plan.platform });
      return setState({ name: "error", message: platformMessage(plan.platform) });
    }

    const ac = new AbortController();
    abort.current = ac;
    setState({ name: "downloading", loaded: 0, total: null });
    try {
      const { file, viaRelay } = await importFromLink(
        plan,
        (loaded, total) => setState({ name: "downloading", loaded, total }),
        ac.signal,
      );
      track("link_imported", { source: viaRelay ? "relay" : "direct" });
      setState({ name: "idle" });
      setUrl("");
      onFile(file);
    } catch (err) {
      if (ac.signal.aborted) return setState({ name: "idle" });
      const message =
        err instanceof LinkImportError ? err.message : "The link couldn't be downloaded. Check that it's public and try again.";
      track("link_imported", { source: "failed", error: message.slice(0, 120) });
      setState({ name: "error", message });
    } finally {
      abort.current = null;
    }
  };

  // A link handed over from a landing page starts on its own, once.
  const started = useRef(false);
  useEffect(() => {
    if (!initialUrl || started.current) return;
    started.current = true;
    const t = setTimeout(() => void run(initialUrl), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const busy = state.name === "downloading";

  return (
    <div className="mt-4 rounded-3xl border border-line bg-surface p-5">
      <p className="text-sm font-medium">Or paste a link</p>
      <p className="mt-0.5 text-xs text-muted">A public link to an audio or video file — Google Drive, Dropbox, or a direct file URL.</p>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && url.trim()) void run(url);
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={url}
          disabled={busy || disabled}
          onChange={(e) => {
            setUrl(e.target.value);
            if (state.name === "error") setState({ name: "idle" });
          }}
          placeholder="https://drive.google.com/file/d/…"
          className="h-11 min-w-0 flex-1 rounded-full border border-line bg-paper px-4 text-sm outline-none focus:border-ink disabled:opacity-50"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="h-11 rounded-full border border-line px-6 text-sm font-medium hover:border-ink"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !url.trim()}
            className="h-11 rounded-full bg-accent px-6 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            Import
          </button>
        )}
      </form>

      {state.name === "downloading" && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full bg-accent transition-[width] ${state.total ? "" : "w-1/3 animate-pulse"}`}
              style={state.total ? { width: `${Math.min(100, (state.loaded / state.total) * 100)}%` } : undefined}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Downloading {mb(state.loaded)}
            {state.total ? ` of ${mb(state.total)}` : ""}…
          </p>
        </div>
      )}

      {state.name === "error" && <p className="mt-2 text-xs leading-relaxed text-danger">{state.message}</p>}

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        The file is downloaded into your browser and transcribed on your device. If the site blocks direct
        downloads, it passes through our server on the way — it isn&apos;t stored there.
      </p>
    </div>
  );
}
