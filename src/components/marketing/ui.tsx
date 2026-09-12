import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Marketing primitives in the obustudio.com visual language:
 * Plus Jakarta Sans 800 display type on very tight tracking, pill buttons,
 * mono uppercase eyebrows, soft-bordered cards on a blue-white ground.
 */

/** "01 THE PRODUCT" — number in accent, label in muted mono caps. */
export function Eyebrow({ n, children, inverse }: { n?: string; children: ReactNode; inverse?: boolean }) {
  return (
    <p className="eyebrow flex items-center justify-center gap-2">
      {n && <span className={inverse ? "text-accent-lift" : "text-accent"}>{n}</span>}
      <span className={inverse ? "text-inverse-soft" : "text-label"}>{children}</span>
    </p>
  );
}

/**
 * The OBU headline: a dark first line, an accent second line, and a period.
 * The period is part of the mark — it appears on every heading on the studio site.
 */
export function Display({
  head,
  accent,
  className = "",
  inverse,
}: {
  head: string;
  accent: string;
  className?: string;
  inverse?: boolean;
}) {
  return (
    <h1 className={`display text-[clamp(2.5rem,7vw,4.5rem)] ${className}`}>
      <span className={inverse ? "text-inverse" : "text-ink"}>{head}</span>
      <br />
      <span className={inverse ? "text-accent-lift" : "text-accent"}>
        {accent}
        <span aria-hidden>.</span>
      </span>
    </h1>
  );
}

/** Same type treatment, one level down, for section headings. */
export function SectionHead({
  head,
  accent,
  inverse,
  className = "",
}: {
  head: string;
  accent: string;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <h2 className={`display text-[clamp(1.9rem,4.4vw,3rem)] ${className}`}>
      <span className={inverse ? "text-inverse" : "text-ink"}>{head}</span>{" "}
      <span className={inverse ? "text-accent-lift" : "text-accent"}>
        {accent}
        <span aria-hidden>.</span>
      </span>
    </h2>
  );
}

type ButtonVariant = "primary" | "ghost" | "ghostInverse" | "white";

const BUTTON_BASE =
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-bold tracking-[-0.02em] transition";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Filled navy — the studio's primary. Not the accent blue; that is for type.
  primary: "bg-deep text-white border border-deep hover:bg-deeper",
  ghost: "border border-line-strong text-ink hover:border-ink",
  // Outlined on a dark band; the light-mode border token is invisible there.
  ghostInverse: "border border-line-inverse text-inverse hover:border-white",
  white: "bg-white text-[#161c2d] border border-white hover:bg-inverse",
};

export function CtaLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** Small bordered mono chip, as used for the tag rows on the studio site. */
export function Chip({ children, inverse }: { children: ReactNode; inverse?: boolean }) {
  return (
    <span
      className={`eyebrow rounded-sm border px-2.5 py-1.5 ${
        inverse ? "border-line-inverse text-inverse-soft" : "border-line-strong text-label"
      }`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-panel border border-line bg-surface p-6 shadow-soft ${className}`}>{children}</div>
  );
}

/** Page-width wrapper. The studio site runs a 1200px column with generous gutters. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-6 ${className}`}>{children}</div>;
}

/**
 * The rounded inner panel the studio site uses to float content above the
 * page ground. Sections sit inside it.
 */
export function Panel({
  children,
  tone = "paper",
  className = "",
}: {
  children: ReactNode;
  tone?: "paper" | "alt" | "deep";
  className?: string;
}) {
  const tones = {
    paper: "bg-surface",
    alt: "bg-panel-alt",
    deep: "bg-deep bg-gradient-to-b from-deep to-deeper",
  };
  return <section className={`rounded-panel ${tones[tone]} ${className}`}>{children}</section>;
}
