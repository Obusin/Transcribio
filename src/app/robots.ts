import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketing/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in surfaces and the local API have nothing to index.
      disallow: ["/api/", "/transcribe", "/sign-in", "/bench"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
