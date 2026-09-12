import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import {
  CtaBand,
  FaqJsonLd,
  FaqSection,
  PricingSection,
  RelatedTools,
  TrustRow,
} from "@/components/marketing/sections";
import { Chip, Container, CtaLink, Display, Eyebrow, Panel, SectionHead } from "@/components/marketing/ui";
import { USE_CASES, getUseCase } from "@/lib/marketing/use-cases";

/**
 * Persona landing pages — the second funnel layer.
 *
 * Fireflies covers ten industries off one product this way: the capability is
 * identical on every page, but the problem is stated in the reader's own terms.
 * Same idea here, minus their invented statistics.
 */

export function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/use-cases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const uc = getUseCase(slug);
  if (!uc) return {};
  return {
    title: uc.title,
    description: uc.description,
    alternates: { canonical: `/use-cases/${uc.slug}` },
    openGraph: { title: uc.title, description: uc.description, url: `/use-cases/${uc.slug}`, type: "website" },
  };
}

export default async function UseCasePage({ params }: PageProps<"/use-cases/[slug]">) {
  const { slug } = await params;
  const uc = getUseCase(slug);
  if (!uc) notFound();

  const siblings = uc.related.map((s) => getUseCase(s)).filter((u) => u !== undefined);

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Container className="py-16 text-center lg:py-20">
          <Eyebrow>Use case</Eyebrow>
          <Display className="mt-6" head={uc.head} accent={uc.accent} />
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted">{uc.sub}</p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <CtaLink href="/transcribe">Start transcribing free</CtaLink>
            <CtaLink href="/tools" variant="ghost">
              See all tools
            </CtaLink>
          </div>

          {/* Fireflies' role tabs, flattened to chips — same job, no interaction cost. */}
          <div className="mt-10">
            <p className="eyebrow mb-4 text-label">Who this is for</p>
            <ul className="flex flex-wrap items-center justify-center gap-2">
              {uc.roles.map((r) => (
                <li key={r}>
                  <Chip>{r}</Chip>
                </li>
              ))}
            </ul>
          </div>
        </Container>

        {/* The problem, stated in the reader's terms. */}
        <Panel tone="deep">
          <Container className="py-20">
            <div className="mx-auto max-w-3xl text-center">
              <Eyebrow n="01" inverse>
                The problem
              </Eyebrow>
              <SectionHead className="mt-5" inverse head={uc.problem.head} accent={uc.problem.accent} />
              <div className="mt-8 space-y-5 text-left text-base leading-relaxed text-inverse-soft">
                {uc.problem.body.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
              </div>
            </div>
          </Container>
        </Panel>

        <Container className="py-20">
          <div className="text-center">
            <Eyebrow n="02">What you get</Eyebrow>
            <SectionHead className="mt-5" head="Built around" accent="how you actually work" />
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {uc.outcomes.map((o) => (
              <div key={o.t} className="rounded-panel border border-line bg-surface p-7 shadow-soft">
                <h3 className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">{o.t}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{o.d}</p>
              </div>
            ))}
          </div>
        </Container>

        <Container className="pb-8">
          <TrustRow />
        </Container>

        <Container className="py-20">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <Eyebrow n="03">The workflow</Eyebrow>
              <SectionHead className="mt-5" head="Start to finish," accent="on your own machine" />
              <div className="mt-8">
                <CtaLink href="/transcribe">Try it now</CtaLink>
              </div>
            </div>
            <ol className="space-y-4">
              {uc.workflow.map((step, i) => (
                <li
                  key={step.slice(0, 30)}
                  className="flex gap-4 rounded-panel border border-line bg-surface p-5 shadow-soft"
                >
                  <span className="eyebrow mt-1 shrink-0 text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-relaxed text-muted">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </Container>

        <FaqSection faqs={uc.faqs} n="04" />
        <PricingSection n="05" />
        <RelatedTools slugs={uc.relatedTools} heading="Tools for this work" />

        {siblings.length > 0 && (
          <Container className="pb-4">
            <div className="text-center">
              <Eyebrow>Other use cases</Eyebrow>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {siblings.map((s) => (
                <Link
                  key={s.slug}
                  href={`/use-cases/${s.slug}`}
                  className="rounded-panel border border-line bg-surface p-6 shadow-soft transition hover:border-ink"
                >
                  <h3 className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">{s.navLabel}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.sub}</p>
                  <span className="mt-4 inline-block text-sm font-bold text-accent">Read more →</span>
                </Link>
              ))}
            </div>
          </Container>
        )}

        <div className="py-16">
          <CtaBand />
        </div>
      </main>

      <SiteFooter />
      <FaqJsonLd faqs={uc.faqs} />
    </div>
  );
}
