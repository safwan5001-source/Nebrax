import type { MetadataRoute } from "next";
import {
  listSitemapIdsForRobots,
  resolveSitemapBaseUrl,
} from "@/lib/data/sitemap";

// Keep the sitemap index in sync with catalog growth instead of freezing the
// chunk list at deployment time.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = await resolveSitemapBaseUrl();
  const sitemaps = await listSitemapIdsForRobots();

  return {
    rules: [
      {
        userAgent: "meta-externalagent",
        disallow: ["/"],
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/*/account",
          "/*/account/*",
          "/*/cart",
          "/*/checkout",
          "/*/checkout/*",
          "/*?*sort=*",
          "/*?*page=*",
          "/*?*filter*=*",
        ],
      },
    ],
    ...(baseUrl
      ? {
          sitemap: sitemaps.map((s) => `${baseUrl}/sitemap/${s.id}.xml`),
          host: baseUrl,
        }
      : {}),
  };
}
