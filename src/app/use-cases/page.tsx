import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import { CtaBand, TrustRow } from "@/components/marketing/sections";
import { Chip, Container, Display, Eyebrow } from "@/components/marketing/ui";
import { USE_CASES } from "@/lib/marketing/use-cases";

export const metadata: Metadata = {
  title: "Use cases",
  description:
    "One engine, many jobs: law offices, clinics, classrooms, hiring, fieldwork, churches and content teams. All on your own device.",
  alternates: { canonical: "/use-cases" },
};

export default function UseCasesIndex() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Container className="py-16 text-center lg:py-20">
          <Eyebrow>Use cases</Eyebrow>
          <Display className="mt-6" head="One engine," accent="a lot of different jobs" />
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted">
            The capability is the same everywhere: local transcription that keeps Taglish as spoken. What
            changes is the problem it solves for you.
          </p>
          <div className="mt-10">
            <TrustRow />
          </div>
        </Container>

        <Container className="pb-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <Link
                key={u.slug}
                href={`/use-cases/${u.slug}`}
                className="flex flex-col rounded-panel border border-line bg-surface p-7 shadow-soft transition hover:border-ink"
              >
                <h2 className="text-lg font-extrabold tracking-[-0.03em] text-ink">{u.navLabel}</h2>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted">{u.sub}</p>
                <ul className="mt-5 flex flex-wrap gap-1.5">
                  {u.roles.slice(0, 3).map((r) => (
                    <li key={r}>
                      <Chip>{r}</Chip>
                    </li>
                  ))}
                </ul>
                <span className="mt-5 inline-block text-sm font-bold text-accent">Read more →</span>
              </Link>
            ))}
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
