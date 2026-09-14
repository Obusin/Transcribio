import Link from "next/link";
import { BetaBanner } from "@/components/beta-banner";
import { FeedbackWidget } from "@/components/feedback";
import { FOOTER_TOOLS, TOOLS } from "@/lib/marketing/funnel";
import { ACCOUNTS_ENABLED } from "@/lib/deployment";
import { FOOTER_USE_CASES, USE_CASES } from "@/lib/marketing/use-cases";
import { Container, CtaLink } from "./ui";

/** Wordmark. Matches the studio's lockup: mark, then the name in 800 weight. */
function Wordmark({ inverse }: { inverse?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid h-7 w-7 place-items-center rounded-lg text-[13px] font-extrabold ${
          inverse ? "bg-white text-[#111f3a]" : "bg-deep text-white"
        }`}
      >
        T
      </span>
      <span
        className={`text-[17px] font-extrabold tracking-[-0.035em] ${inverse ? "text-inverse" : "text-ink"}`}
      >
        Transcribio
      </span>
    </Link>
  );
}

const NAV = [
  { href: "/tools", label: "Tools" },
  { href: "/use-cases", label: "Use cases" },
  { href: "/tools/taglish-transcription", label: "Taglish" },
  { href: "/#free", label: "Free beta" },
  { href: "/convert", label: "PDF to Word" },
];

/**
 * Sticky marketing header. The CTA pill on the right is the only filled button
 * in the bar, so the next step is never ambiguous on any funnel page.
 */
export function SiteHeader() {
  return (
    <>
    <BetaBanner />
    {/* Feedback on every marketing page too: "what stopped you trying it" is worth hearing. */}
    <FeedbackWidget />
    {/* Opaque, not translucent: the page runs full-bleed dark bands underneath
        and a blurred bar over navy reads as a smudge. */}
    <header className="sticky top-0 z-50 border-b border-line bg-paper">
      <Container className="flex h-[68px] items-center justify-between gap-4">
        <Wordmark />

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted transition hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {ACCOUNTS_ENABLED && (
            <Link
              href="/sign-in"
              className="hidden text-sm font-medium text-muted transition hover:text-ink sm:block"
            >
              Sign in
            </Link>
          )}
          <CtaLink href="/transcribe" className="h-10 px-4 text-[13px]">
            Start transcribing
          </CtaLink>
        </div>
      </Container>

      {/*
       * Phones get the nav as a scrollable strip instead of losing it. Without
       * this the only route to the tools and use cases is the footer.
       */}
      <div className="border-t border-line md:hidden">
        <nav className="flex gap-5 overflow-x-auto px-6 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[...NAV, ...(ACCOUNTS_ENABLED ? [{ href: "/sign-in", label: "Sign in" }] : [])].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="shrink-0 text-[13px] font-medium whitespace-nowrap text-muted transition hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
    </>
  );
}

/**
 * Footer with the tool link farm. Every funnel page links to every other one,
 * which is how the keyword pages pass authority around instead of each sitting
 * on its own island.
 */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-panel-alt">
      <Container className="py-14">
        {/* Product / Use cases / Free tools, the way Fireflies splits its footer. */}
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              Transcription that runs on your own device. English, Filipino and Taglish — written down the way
              it was said.
            </p>
            <p className="mt-5 text-sm font-medium text-ink">
              An <a className="underline decoration-line-strong underline-offset-4 hover:text-accent" href="https://obustudio.com">OBU Studio</a> product
            </p>
          </div>

          <div>
            <p className="eyebrow mb-4 text-label">Free tools</p>
            <ul className="space-y-2.5">
              {FOOTER_TOOLS.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="text-sm text-muted transition hover:text-ink">
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="eyebrow mb-4 text-label">Use cases</p>
            <ul className="space-y-2.5">
              {FOOTER_USE_CASES.map((u) => (
                <li key={u.href}>
                  <Link href={u.href} className="text-sm text-muted transition hover:text-ink">
                    {u.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/use-cases" className="text-sm font-medium text-accent transition hover:text-ink">
                  All use cases →
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="eyebrow mb-4 text-label">Product</p>
            <ul className="space-y-2.5">
              {[
                { href: "/transcribe", label: "Open the app" },
                { href: "/tools", label: "All tools" },
                { href: "/use-cases", label: "All use cases" },
                { href: "/#free", label: "Free while testing" },
                { href: "/#how", label: "How it works" },
                { href: "/#faq", label: "FAQ" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted transition hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} OBU Studio. All rights reserved.</p>
          <p>{TOOLS.length} free tools · {USE_CASES.length} use cases · Manila, Philippines</p>
        </div>
      </Container>
    </footer>
  );
}
