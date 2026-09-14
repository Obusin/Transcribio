import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ERROR_KINDS, type Contribution } from "@/lib/contribution";
import { browserLabel, readJsonBlobs } from "@/server/pilot-data";

/**
 * Private pilot dashboard: /admin?token=ADMIN_TOKEN
 *
 * Everything testers send — usage events, ratings, feedback and opt-in shared
 * transcripts — read straight from the private Blob store. Anyone without the
 * token gets a plain 404, and the page is never indexed or cached.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pilot data", robots: { index: false, follow: false } };

interface Event {
  name: string;
  props: Record<string, unknown>;
  device: string;
  ua?: string;
  at: string;
}

type Shared = Contribution & { at: string; device: string; pilot?: string; ua?: string };

const ERROR_LABEL = Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k.label])) as Record<string, string>;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const mins = (s: unknown) => {
  if (typeof s !== "number") return "—";
  if (s < 3600) return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const token = (await searchParams).token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) notFound();

  const [events, shared] = await Promise.all([
    readJsonBlobs<Event>("events/", 3000),
    readJsonBlobs<Shared>("contributions/", 200),
  ]);

  const count = (name: string) => events.filter((e) => e.name === name).length;
  const devices = new Set(events.map((e) => e.device)).size;
  const ratings = events.filter((e) => e.name === "transcript_rated");
  const avg = ratings.length
    ? (ratings.reduce((a, e) => a + Number(e.props.rating ?? 0), 0) / ratings.length).toFixed(1)
    : "—";
  const errorCounts = new Map<string, number>();
  for (const r of ratings) {
    for (const k of String(r.props.errors ?? "").split(",").filter(Boolean)) errorCounts.set(k, (errorCounts.get(k) ?? 0) + 1);
  }
  const started = count("transcribe_started");
  const finished = count("transcribe_finished");
  const problems = events.filter((e) => ["transcribe_failed", "transcribe_crashed", "model_load_failed"].includes(e.name));
  const feedback = events.filter((e) => e.name === "feedback" || (e.name === "transcript_rated" && e.props.message));

  const stats: [string, string | number, string?][] = [
    ["Devices", devices],
    ["Opened the app", count("app_opened")],
    ["Model loaded", count("model_loaded"), `${count("model_load_failed")} failed`],
    ["Transcriptions started", started],
    ["Finished", finished, `${pct(finished, started)} of started`],
    ["Crashed / failed", count("transcribe_crashed") + count("transcribe_failed")],
    ["Ratings", ratings.length, `avg ${avg} / 5`],
    ["Shared transcripts", shared.length],
    ["Exports", count("exported")],
    ["Link imports", count("link_imported")],
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 text-sm">
      <h1 className="text-2xl font-extrabold tracking-tight">Pilot data</h1>
      <p className="mt-1 text-muted">
        Newest first · times in Manila · {events.length} events read. Content-free except feedback people typed and
        transcripts people chose to share.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted">{sub}</p>}
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">Mistakes people reported</h2>
        {errorCounts.size === 0 ? (
          <p className="mt-2 text-muted">No ratings with mistakes yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {[...errorCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <li key={k} className="rounded-full border border-line bg-surface px-3 py-1">
                  {ERROR_LABEL[k] ?? k} <strong className="tabular-nums">{n}</strong>
                </li>
              ))}
          </ul>
        )}
      </section>

      <Table
        title="Feedback & comments"
        empty="No written feedback yet."
        head={["When", "Rating", "Message", "Tester", "Browser"]}
        rows={feedback.map((e) => [
          when(e.at),
          e.props.rating ? `${e.props.rating}/5` : "—",
          String(e.props.message ?? ""),
          String(e.props.pilot ?? "—"),
          browserLabel(e.ua),
        ])}
      />

      <Table
        title="Ratings"
        empty="No ratings yet."
        head={["When", "Rating", "Mistakes", "Length", "Language", "Shared"]}
        rows={ratings.map((e) => [
          when(e.at),
          `${e.props.rating}/5`,
          String(e.props.errors ?? "").split(",").filter(Boolean).map((k) => ERROR_LABEL[k] ?? k).join(", ") || "—",
          mins(e.props.durationSeconds),
          String(e.props.language ?? "—"),
          e.props.shared ? "yes" : "no",
        ])}
      />

      <Table
        title="Crashes & failures"
        empty="None recorded."
        head={["When", "What", "Detail", "Length", "Mode", "Device", "Browser"]}
        rows={problems.map((e) => [
          when(e.at),
          e.name.replace(/_/g, " "),
          e.name === "transcribe_crashed"
            ? `saved ${mins(e.props.processedSeconds)}, ran ${e.props.minutesRunning ?? "?"} min`
            : String(e.props.error ?? "—"),
          mins(e.props.durationSeconds),
          String(e.props.profile ?? "—"),
          `${e.props.webgpu ? "GPU" : "CPU"} · ${e.props.deviceTier ?? "?"}`,
          browserLabel(e.ua),
        ])}
      />

      <section className="mt-10">
        <h2 className="text-lg font-bold">Shared transcripts</h2>
        <p className="mt-1 text-muted">Only lines people corrected are shown by default — that&apos;s where the engine went wrong.</p>
        {shared.length === 0 ? (
          <p className="mt-2 text-muted">Nobody has shared a transcript yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {shared.map((c, i) => {
              const fixes = c.lines.filter((l) => l.corrected != null);
              return (
                <details key={i} className="rounded-2xl border border-line bg-surface p-4">
                  <summary className="cursor-pointer">
                    <strong>{c.rating}/5</strong> · {when(c.at)} · {mins(c.transcript.durationSeconds)} ·{" "}
                    {c.transcript.detectedLanguages.join(", ") || c.transcript.language} · {c.transcript.lineCount} lines,{" "}
                    {c.transcript.correctedCount} corrected
                    {c.errors.length > 0 && <> · {c.errors.map((k) => ERROR_LABEL[k] ?? k).join(", ")}</>}
                    {c.pilot && <> · tester {c.pilot}</>}
                  </summary>
                  {c.comment && <p className="mt-3 rounded-xl bg-paper p-3">“{c.comment}”</p>}
                  {fixes.length > 0 && (
                    <table className="mt-3 w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-line text-xs text-muted">
                          <th className="py-2 pr-3 font-normal">At</th>
                          <th className="py-2 pr-3 font-normal">Engine said</th>
                          <th className="py-2 font-normal">Corrected to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fixes.map((l, j) => (
                          <tr key={j} className="border-b border-line align-top">
                            <td className="py-2 pr-3 font-mono text-xs text-muted">{Math.floor(l.start / 60)}:{String(Math.floor(l.start % 60)).padStart(2, "0")}</td>
                            <td className="py-2 pr-3 text-danger">{l.raw}</td>
                            <td className="py-2">{l.corrected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted">Full transcript ({c.lines.length} lines)</summary>
                    <div className="mt-2 max-h-96 space-y-1 overflow-y-auto rounded-xl bg-paper p-3 text-xs leading-relaxed">
                      {c.lines.map((l, j) => (
                        <p key={j}>{l.corrected ?? l.raw}</p>
                      ))}
                    </div>
                  </details>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function Table({ title, empty, head, rows }: { title: string; empty: string; head: string[]; rows: string[][] }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-muted">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                {head.map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={i} className="border-b border-line align-top last:border-0">
                  {r.map((cell, j) => (
                    <td key={j} className="px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
