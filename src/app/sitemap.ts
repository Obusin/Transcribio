import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/marketing/funnel";
import { SITE_URL } from "@/lib/marketing/site";
import { USE_CASES } from "@/lib/marketing/use-cases";

/** Every public funnel page. The app itself (/transcribe) is behind sign-in, so it stays out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/tools`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/use-cases`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/convert`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...TOOLS.map((t) => ({
      url: `${SITE_URL}/tools/${t.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...USE_CASES.map((u) => ({
      url: `${SITE_URL}/use-cases/${u.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
