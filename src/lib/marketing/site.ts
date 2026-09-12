/**
 * Canonical origin for metadata, sitemap and robots.
 *
 * There is no production domain committed anywhere in this repo yet, so rather
 * than inventing one, set NEXT_PUBLIC_SITE_URL at build time. Everything
 * SEO-facing reads from here, so the funnel gets correct absolute URLs the
 * moment that variable is set.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
