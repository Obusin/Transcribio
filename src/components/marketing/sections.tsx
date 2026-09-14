import Link from "next/link";
import { type Faq, TOOLS, TRUST_CHIPS } from "@/lib/marketing/funnel";
import { USE_CASES } from "@/lib/marketing/use-cases";
import { Chip, Container, CtaLink, Eyebrow, Panel, SectionHead } from "./ui";

/** Trust chip row. Every claim here is something the app actually does. */
export function TrustRow({ inverse }: { inverse?: boolean }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-2">
      {TRUST_CHIPS.map((c) => (
        <li key={c}>
          <Chip inverse={inverse}>{c}</Chip>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  {
    n: "01",
    t: "Drop the file in",
    d: "Video or audio, any length. Your browser reads it straight off your disk — there is no upload bar because there is no upload.",
  },
  {
    n: "02",
    t: "Pick the language",
    d: "Filipino / Taglish keeps code-switching as spoken. English-only is there for recordings with no Filipino in them.",
  },
  {
    n: "03",
    t: "Edit and export",
    d: "Click any line to jump to that moment. Fix what needs fixing, then take it as PDF, Word, TXT, SRT or VTT.",
  },
];

export function HowItWorks() {
  return (
    <Container className="py-20" >
      <div id="how" className="scroll-mt-24 text-center">
        <Eyebrow n="01">How it works</Eyebrow>
        <SectionHead className="mt-5" head="Three steps," accent="no account for the file" />
      </div>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-panel border border-line bg-surface p-7 shadow-soft">
            <span className="eyebrow text-accent">{s.n}</span>
            <h3 className="mt-3 text-lg font-extrabold tracking-[-0.03em] text-ink">{s.t}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted">{s.d}</p>
          </div>
        ))}
      </div>
    </Container>
  );
}

const COMPARISON: { point: string; cloud: string; ours: string }[] = [
  {
    point: "Where your recording goes",
    cloud: "Uploaded to a server you don't control",
    ours: "Stays on your device — never transmitted",
  },
  {
    point: "Filipino and Taglish",
    cloud: "Often silently translated into English",
    ours: "Decoded in Filipino, code-switching intact",
  },
  {
    point: "File size and length",
    cloud: "Capped by your plan",
    ours: "Capped by your own machine",
  },
  {
    point: "Cost per minute",
    cloud: "Someone is paying for GPU time",
    ours: "Your computer already did the work",
  },
  {
    point: "If the company disappears",
    cloud: "Your transcripts go with it",
    ours: "Everything is already on your disk",
  },
];

/**
 * The differentiator section. Transcribio's whole pitch against TurboScribe and
 * the rest of the category is that the file never moves, so this is stated as a
 * direct comparison rather than buried in a feature list.
 */
export function VersusCloud() {
  return (
    <Panel tone="deep" className="overflow-hidden">
      <Container className="py-20">
        <div className="text-center">
          <Eyebrow n="02" inverse>
            Why this is different
          </Eyebrow>
          <SectionHead className="mt-5" inverse head="Every other tool" accent="uploads your recording" />
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-inverse-soft">
            That single design decision is where the price, the limits and the privacy policy all come from.
            Remove the upload and most of them stop being problems.
          </p>
        </div>

        <div className="mt-14 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line-inverse">
                <th className="eyebrow py-3 pr-4 font-normal text-inverse-soft"> </th>
                <th className="eyebrow py-3 pr-4 font-normal text-inverse-soft">Cloud transcription</th>
                <th className="eyebrow py-3 font-normal text-accent-lift">Transcribio</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((r) => (
                <tr key={r.point} className="border-b border-line-inverse/60 align-top">
                  <td className="py-4 pr-4 text-sm font-bold text-inverse">{r.point}</td>
                  <td className="py-4 pr-4 text-sm leading-relaxed text-inverse-soft">{r.cloud}</td>
                  <td className="py-4 text-sm font-medium leading-relaxed text-white">{r.ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </Panel>
  );
}

/** FAQ accordion. `details`/`summary` so it works with no JavaScript. */
export function FaqSection({ faqs, n = "03" }: { faqs: Faq[]; n?: string }) {
  return (
    <Container className="py-20">
      <div id="faq" className="scroll-mt-24 text-center">
        <Eyebrow n={n}>Questions</Eyebrow>
        <SectionHead className="mt-5" head="Frequently asked" accent="questions" />
      </div>
      <div className="mx-auto mt-12 max-w-3xl divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
        {faqs.map((f) => (
          <details key={f.q} className="group px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-bold tracking-[-0.02em] text-ink marker:hidden">
              {f.q}
              <span
                aria-hidden
                className="shrink-0 text-lg font-normal text-label transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </Container>
  );
}

/** FAQPage structured data, so these pages can win the rich result. */
export function FaqJsonLd({ faqs }: { faqs: Faq[] }) {
  const json = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />;
}

const INCLUDED = [
  "Unlimited transcription — no daily cap",
  "Every language mode, including Taglish",
  "All exports — PDF, Word, TXT, SRT, VTT",
  "Transcript editor and Reviewer",
  "Paste-a-link import from Drive and Dropbox",
  "No sign-up and no credit card",
];

/**
 * Free while testing. This replaced the pricing section on 2026-09-14: there
 * are no plans or prices anywhere on the site until billing is decided, and the
 * one thing asked of people in return is feedback.
 */
export function FreeBetaSection({ n = "04" }: { n?: string }) {
  return (
    <Container className="py-20">
      <div id="free" className="scroll-mt-24 text-center">
        <Eyebrow n={n}>Free while we test it</Eyebrow>
        <SectionHead className="mt-5" head="Everything is free" accent="while we're testing" />
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted">
          No plans, no limits, no sign-up. We&apos;re still improving Transcribio, so the only thing we ask in
          return is your honest feedback.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
        <div className="rounded-panel border border-line bg-surface p-8 shadow-soft">
          <p className="eyebrow text-label">What you get</p>
          <p className="mt-4 text-5xl font-extrabold tracking-[-0.045em] text-ink">Free</p>
          <p className="mt-2 text-sm text-muted">During testing. Everything included.</p>
          <ul className="mt-7 space-y-3">
            {INCLUDED.map((f) => (
              <li key={f} className="flex gap-2.5 text-sm leading-relaxed text-muted">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {f}
              </li>
            ))}
          </ul>
          <CtaLink href="/transcribe" className="mt-8 w-full">
            Start transcribing
          </CtaLink>
        </div>

        <div className="rounded-panel border border-deep bg-deep bg-gradient-to-b from-deep to-deeper p-8 shadow-float">
          <p className="eyebrow text-inverse-soft">What we ask</p>
          <p className="mt-4 text-4xl font-extrabold tracking-[-0.045em] text-inverse">Tell us what to fix</p>
          <p className="mt-4 text-sm leading-relaxed text-inverse-soft">
            Use the <strong className="text-inverse">Give feedback</strong> button at the bottom right of any page.
            It takes a minute and goes straight to the people building this.
          </p>
          <ul className="mt-7 space-y-3">
            {[
              "It crashed, froze or was slow on your computer",
              "It misheard words, or got Taglish wrong",
              "Something was confusing or hard to find",
              "A feature you wish it had",
            ].map((f) => (
              <li key={f} className="flex gap-2.5 text-sm leading-relaxed text-inverse-soft">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-lift" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-7 text-xs leading-relaxed text-inverse-soft">
            Feedback sends what you type plus basic browser info. After a transcription you can also rate its
            accuracy, and optionally share that transcript&apos;s text to help us fix mistakes — only if you tick the
            box. Recordings are never sent.
          </p>
        </div>
      </div>
    </Container>
  );
}

/** Closing CTA band. Repeats the offer at the bottom of every funnel page. */
export function CtaBand() {
  return (
    <Container>
      <Panel tone="deep" className="px-6 py-16 text-center sm:px-12">
        <Eyebrow inverse>Free while we test it</Eyebrow>
        <SectionHead className="mt-5" inverse head="Your first transcript" accent="is a drag and a drop" />
        <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-inverse-soft">
          Free during testing, no sign-up, and the recording never leaves your computer. Try it, then tell us
          what to improve.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <CtaLink href="/transcribe" variant="white">
            Start transcribing free
          </CtaLink>
          <CtaLink href="/#free" variant="ghostInverse">
            Why it&apos;s free
          </CtaLink>
        </div>
      </Panel>
    </Container>
  );
}

/**
 * "Useful for many" made concrete on the landing page.
 *
 * Fireflies proves breadth by listing the industries it serves right on the home
 * page; the capability never changes, only the framing. Same move here.
 */
export function UseCaseStrip({ n = "03" }: { n?: string }) {
  return (
    <Container className="py-20">
      <div className="text-center">
        <Eyebrow n={n}>Who uses it</Eyebrow>
        <SectionHead className="mt-5" head="One engine," accent="a lot of different jobs" />
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted">
          Same transcription, same privacy, pointed at whatever you actually record.
        </p>
      </div>

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {USE_CASES.map((u) => (
          <Link
            key={u.slug}
            href={`/use-cases/${u.slug}`}
            className="flex flex-col rounded-panel border border-line bg-surface p-6 shadow-soft transition hover:border-ink"
          >
            <h3 className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">{u.navLabel}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{u.sub}</p>
            <span className="mt-4 inline-block text-sm font-bold text-accent">Read more →</span>
          </Link>
        ))}

        <Link
          href="/use-cases"
          className="flex flex-col justify-center rounded-panel border border-line bg-panel-alt p-6 text-center shadow-soft transition hover:border-ink"
        >
          <span className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">All use cases</span>
          <span className="mt-2 text-sm text-muted">Plus every free tool →</span>
        </Link>
      </div>
    </Container>
  );
}

/** Cross-links between funnel pages, shown above the footer on tool pages. */
export function RelatedTools({ slugs, heading = "Other free tools" }: { slugs: string[]; heading?: string }) {
  const related = slugs.map((s) => TOOLS.find((t) => t.slug === s)).filter((t) => t !== undefined);
  if (!related.length) return null;

  return (
    <Container className="py-20">
      <div className="text-center">
        <Eyebrow>{heading}</Eyebrow>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {related.map((t) => (
          <Link
            key={t.slug}
            href={`/tools/${t.slug}`}
            className="group rounded-panel border border-line bg-surface p-6 shadow-soft transition hover:border-ink"
          >
            <h3 className="text-[15px] font-extrabold tracking-[-0.03em] text-ink">{t.linkLabel}</h3>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{t.sub}</p>
            <span className="mt-4 inline-block text-sm font-bold text-accent">Open tool →</span>
          </Link>
        ))}
      </div>
    </Container>
  );
}
