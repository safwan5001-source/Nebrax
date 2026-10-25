import type { MetadataRoute } from "next";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import {
  getMarketLocaleTargets,
  type MarketLocaleTarget,
} from "@/i18n/markets";
import {
  announceTruncation,
  describeSitemapFailure,
  getSitemapCategories,
  getSitemapMarkets,
  getSitemapProductPage,
  ITEMS_PER_PAGE,
  listSitemapIds,
  MAX_PAGES,
  MAX_SITEMAPS,
  PRODUCT_PAGES_PER_SITEMAP,
  reserveSitemapRequests,
  resolveSitemapBaseUrl,
  type SitemapCategory,
  type SitemapProduct,
  type SitemapProductPage,
} from "@/lib/data/sitemap";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

export const dynamic = "force-dynamic";

type CountryLocale = MarketLocaleTarget;

/** Protocol ceiling per file (Google: 50,000); only file 0 can approach it. */
const MAX_URLS_PER_SITEMAP = 50_000;

const UNAVAILABLE_MESSAGE = "Sitemap is temporarily unavailable.";

/**
 * Upstream requests a file costs, reserved before any is made: the default
 * locale lookup, the category tree (file 0) and its product pages.
 */
function requestsForSitemap(id: number): number {
  const pages = Math.min(
    PRODUCT_PAGES_PER_SITEMAP,
    Math.max(0, MAX_PAGES - id * PRODUCT_PAGES_PER_SITEMAP),
  );
  return 1 + (id === 0 ? 1 : 0) + pages;
}

/**
 * Next's metadata loader calls this on EVERY file request and answers 404 for
 * an id that is not in the list, before `sitemap()` runs. So it must be the
 * truth or an error: a temporary failure (API down, rate limit, exhausted
 * budget) throws, which the loader turns into a retryable 5xx. robots.txt has
 * its own tolerant discovery (`listSitemapIdsForRobots`).
 *
 * The one exception is `next build`, where there is no request, no Host and no
 * API: prerendering has nothing to validate, so a single file is declared.
 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  try {
    return await listSitemapIds();
  } catch (error) {
    console.error(
      `Sitemap index unavailable: ${describeSitemapFailure(error)}`,
    );
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return [{ id: 0 }];
    }
    throw new Error(UNAVAILABLE_MESSAGE);
  }
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  if (!Number.isSafeInteger(id) || id < 0) return [];
  // Beyond the last addressable file there is nothing to list and nothing to ask.
  if (id >= MAX_SITEMAPS) return [];

  try {
    return await buildSitemapChunk(id);
  } catch (error) {
    // A failed read must not become a 200 sitemap that looks authoritative but
    // silently lacks products. Log the detail server-side and answer with a
    // generic 5xx so crawlers retry and monitoring sees it.
    console.error(
      `Sitemap file ${id} failed: ${describeSitemapFailure(error)}`,
    );
    throw new Error(UNAVAILABLE_MESSAGE);
  }
}

async function buildSitemapChunk(id: number): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await resolveSitemapBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "No absolute http(s) base URL: the request has no usable Host and " +
        "NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL is not set.",
    );
  }

  reserveSitemapRequests(requestsForSitemap(id));

  const countryLocales = await resolveCountryLocales();
  const firstPage = id * PRODUCT_PAGES_PER_SITEMAP + 1;
  const lastPage = Math.min(
    MAX_PAGES,
    firstPage + PRODUCT_PAGES_PER_SITEMAP - 1,
  );
  const pageNumbers = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );

  const [categories, pages] = await Promise.all([
    id === 0 ? getSitemapCategories() : Promise.resolve([]),
    Promise.all(
      pageNumbers.map((page) => getSitemapProductPage(page, ITEMS_PER_PAGE)),
    ),
  ]);

  const products: SitemapProduct[] = [];
  for (const [index, page] of pages.entries()) {
    warnOnShortPage(pageNumbers[index], page);
    products.push(...page.items);
  }
  if (id === 0 && pages[0]) announceTruncation(pages[0].total);

  const entries: MetadataRoute.Sitemap = [];
  for (const target of countryLocales) {
    const basePath = `${baseUrl}/${target.country}/${target.locale}`;
    if (id === 0) {
      appendStaticEntries(entries, basePath);
      appendCategoryEntries(entries, basePath, categories);
    }
    appendProductEntries(entries, baseUrl, basePath, products);
  }

  if (entries.length > MAX_URLS_PER_SITEMAP) {
    console.warn(
      `Sitemap file ${id} has ${entries.length} URLs; only the first ` +
        `${MAX_URLS_PER_SITEMAP} are served (protocol limit).`,
    );
    return entries.slice(0, MAX_URLS_PER_SITEMAP);
  }
  return entries;
}

function appendStaticEntries(
  entries: MetadataRoute.Sitemap,
  basePath: string,
): void {
  entries.push(
    { url: basePath, changeFrequency: "daily", priority: 1 },
    { url: `${basePath}/products`, changeFrequency: "daily", priority: 0.8 },
  );
}

/** Same-origin image paths become absolute; anything else absolute is kept. */
function absoluteImageUrl(baseUrl: string, imageUrl: string): string | null {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) {
    return new URL(imageUrl, baseUrl).toString();
  }
  return null;
}

function appendProductEntries(
  entries: MetadataRoute.Sitemap,
  baseUrl: string,
  basePath: string,
  products: SitemapProduct[],
): void {
  for (const product of products) {
    const image = product.image_url
      ? absoluteImageUrl(baseUrl, product.image_url)
      : null;

    entries.push({
      url: `${basePath}/products/${encodeURIComponent(product.id)}`,
      ...(product.updated_at
        ? { lastModified: new Date(product.updated_at) }
        : {}),
      changeFrequency: "weekly",
      priority: 0.6,
      ...(image ? { images: [image] } : {}),
    });
  }
}

function appendCategoryEntries(
  entries: MetadataRoute.Sitemap,
  basePath: string,
  categories: SitemapCategory[],
): void {
  for (const category of categories) {
    entries.push({
      url: `${basePath}/c/${encodeURIComponent(category.id)}`,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
}

/** Resolve every valid country/locale URL exposed by the configured Market. */
async function resolveCountryLocales(): Promise<CountryLocale[]> {
  const markets = await getSitemapMarkets();
  const targets = getMarketLocaleTargets(markets);

  return targets.length > 0
    ? targets
    : [
        {
          marketId: "default",
          country: getDefaultCountry(),
          locale: resolveSupportedLocale(getDefaultLocale()) ?? DEFAULT_LOCALE,
        },
      ];
}

/**
 * A page that holds fewer rows than its position in the catalog implies means
 * the catalog changed while the chunk was being read (or the API sent rows
 * without an id). The chunk is still served, but never without a trace.
 */
function warnOnShortPage(page: number, result: SitemapProductPage): void {
  const expected = Math.min(
    ITEMS_PER_PAGE,
    Math.max(0, result.total - (page - 1) * ITEMS_PER_PAGE),
  );
  if (result.items.length < expected) {
    console.warn(
      `Sitemap: product page ${page} returned ${result.items.length} of ` +
        `${expected} expected rows; some published products may be missing.`,
    );
  }
}
