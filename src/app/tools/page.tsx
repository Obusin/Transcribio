import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { CtaBand, TrustRow } from "@/components/marketing/sections";
import { Container, Display, Eyebrow } from "@/components/marketing/ui";
import { TOOLS } from "@/lib/marketing/funnel";

export const metadata: Metadata = {
  title: "Free transcription tools",
  description:
    "Every Transcribio tool: video to text, audio to text, Tagalog and Taglish transcription, subtitles, meetings and interviews. All free, all on your own device.",
  alternates: { canonical: "/tools" },
};

/** Hub page for the keyword landing pages, so they are one click from anywhere. */
export default function ToolsIndex() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Container className="py-16 text-center lg:py-20">
          <Eyebrow>All tools</Eyebrow>
          <Display className="mt-6" head="Every tool, free" accent="and fully on-device" />
          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-muted">
            Same engine, same privacy, pointed at whatever job you actually have.
          </p>
          <div className="mt-10">
            <TrustRow />
          </div>
        </Container>

        <Container className="pb-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t) => (
              <Link
                key={t.slug}
                href={`/tools/${t.slug}`}
                className="rounded-panel border border-line bg-surface p-7 shadow-soft transition hover:border-ink"
              >
                <h2 className="text-lg font-extrabold tracking-[-0.03em] text-ink">{t.linkLabel}</h2>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{t.sub}</p>
                <span className="mt-5 inline-block text-sm font-bold text-accent">Open tool →</span>
              </Link>
            ))}

            <Link
              href="/convert"
              className="rounded-panel border border-line bg-panel-alt p-7 shadow-soft transition hover:border-ink"
            >
              <h2 className="text-lg font-extrabold tracking-[-0.03em] text-ink">PDF to Word</h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                A separate converter that works the same way — turns a PDF into an editable Word document on
                your own device.
              </p>
              <span className="mt-5 inline-block text-sm font-bold text-accent">Open converter →</span>
            </Link>
          </div>
        </Container>

        <div className="py-16">
          <CtaBand />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
