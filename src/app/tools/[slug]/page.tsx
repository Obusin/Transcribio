import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import {
  CtaBand,
  FaqJsonLd,
  FaqSection,
  HowItWorks,
  FreeBetaSection,
  RelatedTools,
  TrustRow,
  VersusCloud,
} from "@/components/marketing/sections";
import { ToolCard } from "@/components/marketing/tool-card";
import { Container, Display, Eyebrow } from "@/components/marketing/ui";
import { TOOLS, getTool } from "@/lib/marketing/funnel";

/**
 * Keyword landing pages — the top of the funnel.
 *
 * One page per search intent, each putting the tool above the fold and
 * cross-linking to its siblings, which is how TurboScribe's acquisition works.
 * All of them prerender at build time from the static list in
 * src/lib/marketing/funnel.ts.
 */

export function generateStaticParams() {
  return TOOLS.map((t) => ({ slug: t.slug }));
}

// Anything not in the list is a 404 rather than an on-demand render, so the
// keyword surface stays exactly as wide as the content we wrote.
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/tools/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.slug}` },
    openGraph: {
      title: tool.title,
      description: tool.description,
      url: `/tools/${tool.slug}`,
      type: "website",
    },
  };
}

export default async function ToolPage({ params }: PageProps<"/tools/[slug]">) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Tool-first hero, centred like the TurboScribe tool pages. */}
        <Container className="py-14 lg:py-20">
          <div className="text-center">
            <Eyebrow>Free tool · runs on your device</Eyebrow>
            <Display className="mt-6" head={tool.head} accent={tool.accent} />
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted">{tool.sub}</p>
          </div>

          <div className="mx-auto mt-12 max-w-xl">
            <ToolCard dropLabel={tool.dropLabel} formats={tool.formats} />
          </div>

          <div className="mt-10">
            <TrustRow />
          </div>
        </Container>

        <HowItWorks />
        <VersusCloud />

        <Container className="py-20">
          <div className="mx-auto max-w-3xl">
            <Eyebrow>About this tool</Eyebrow>
            <h2 className="display mt-5 text-[clamp(1.6rem,3.4vw,2.2rem)] text-ink">{tool.linkLabel}</h2>
            <div className="mt-6 space-y-5 text-base leading-relaxed text-muted">
              {tool.about.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </div>
        </Container>

        <FaqSection faqs={tool.faqs} />
        <FreeBetaSection />
        <RelatedTools slugs={tool.related} />
        <CtaBand />
      </main>

      <SiteFooter />
      <FaqJsonLd faqs={tool.faqs} />
    </div>
  );
}
