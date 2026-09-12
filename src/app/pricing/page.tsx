import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/marketing/chrome";
import {
  CtaBand,
  FaqJsonLd,
  FaqSection,
  PricingSection,
  VersusCloud,
} from "@/components/marketing/sections";
import { Container, Display, Eyebrow } from "@/components/marketing/ui";
import { PRICING, type Faq } from "@/lib/marketing/funnel";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Transcribio pricing. ${PRICING.freeDailyMinutes} free minutes of transcription a day, no credit card. Pro lifts the daily limit.`,
  alternates: { canonical: "/pricing" },
};

const PRICING_FAQS: Faq[] = [
  {
    q: "Why is the free plan this generous?",
    a: "Because transcription runs on your computer, not ours. There are no GPU minutes to bill for, so the free plan costs us almost nothing to offer.",
  },
  {
    q: `What happens when I hit ${PRICING.freeDailyMinutes} minutes?`,
    a: "The daily budget resets at midnight Manila time. Pro removes the limit for people transcribing in bulk every day.",
  },
  {
    q: "Can I pay in pesos?",
    a: "That is the plan — PayMongo, so GCash, Maya and local cards all work. Billing is not switched on yet.",
  },
  {
    q: "Do I lose my transcripts if I stop paying?",
    a: "No. Transcripts live in your browser on your own machine. Downgrading changes your daily limit, not your history.",
  },
  {
    q: "Is there a free trial of Pro?",
    a: "The free plan is not a trial, so there is nothing to expire. When billing launches we will say exactly how Pro is trialled rather than guess now.",
  },
];

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Container className="py-16 text-center lg:py-20">
          <Eyebrow>Pricing</Eyebrow>
          <Display className="mt-6" head="Free because your computer" accent="does the work" />
          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-muted">
            No GPUs to rent means no per-minute cost to pass on. {PRICING.freeDailyMinutes} minutes a day,
            every feature included, no credit card.
          </p>
        </Container>

        <PricingSection n="01" />
        <VersusCloud />
        <FaqSection faqs={PRICING_FAQS} n="03" />
        <CtaBand />
      </main>

      <SiteFooter />
      <FaqJsonLd faqs={PRICING_FAQS} />
    </div>
  );
}
