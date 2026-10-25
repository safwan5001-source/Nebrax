import type { MetadataRoute } from "next";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import {
  getMarketLocaleTargets,
  type MarketLocaleTarget,
} from "@/i18n/markets";
import {
  describeSitemapFailure,
  getSitemapCategories,
  getSitemapMarkets,
  getSitemapProductPage,
  reserveSitemapRequests,
  resolveSitemapBaseUrl,
  type SitemapCategory,
  type SitemapProduct,
  type SitemapProductPage,
} from "@/lib/data/sitemap";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

export const dynamic = "force-dynamic";

type CountryLocale = MarketLocaleTarget;

/**
 * Sitemap layout — shaped by the upstream request budget, not by URL count.
 *
 * `store/v1` allows 30 requests / 60 s per server IP, shared with all live
 * storefront traffic (see `lib/data/sitemap.ts`). A file therefore covers a
 * FIXED number of product API pages, so its cost is known before it starts:
 *   file 0   = static pages + every category + product pages 1..N
 *   file k>0 = product pages kN+1..(k+1)N
 * Each product page holds 100 products and every product is listed once per
 * locale. Files are small on purpose; a large catalog means many files that the
 * crawler fetches over time, never one request that tries to walk everything.
 */
const PRODUCT_PAGES_PER_SITEMAP = 5;
const ITEMS_PER_PAGE = 100;
const MAX_PAGES = 1000;
/** Maximum products we can actually list, given pagination limits. */
const MAX_FETCHABLE_ITEMS = ITEMS_PER_PAGE * MAX_PAGES;
/** Protocol ceiling per file (Google: 50,000); only file 0 can approach it. */
const MAX_URLS_PER_SITEMAP = 50_000;
const MAX_SITEMAPS = Math.ceil(MAX_PAGES / PRODUCT_PAGES_PER_SITEMAP);

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

/** Cost of the index: the locale lookup and one product row for the total. */
const INDEX_REQUESTS = 2;

/**
 * Lists the sitemap files. Reads only the product total (one row). A failure,
 * including an exhausted request budget, degrades to a single file — it must
 * never take robots.txt down with it.
 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  try {
    reserveSitemapRequests(INDEX_REQUESTS);
    await resolveCountryLocales();
    const total = Math.min(
      announceTruncation((await getSitemapProductPage(1, 1)).total),
      MAX_FETCHABLE_ITEMS,
    );
    const pagesPerFile = PRODUCT_PAGES_PER_SITEMAP * ITEMS_PER_PAGE;
    const count = Math.max(1, Math.ceil(total / pagesPerFile));

    return Array.from({ length: count }, (_, id) => ({ id }));
  } catch (error) {
    // API may be unavailable (build time, outage, rate limit). Return a single
    // sitemap file; it is populated on demand when the API recovers.
    console.error(
      `Sitemap index fell back to a single file: ${describeSitemapFailure(error)}`,
    );
    return [{ id: 0 }];
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

function announceTruncation(total: number): number {
  if (total > MAX_FETCHABLE_ITEMS) {
    // Announced, never silent: these products cannot be listed by this route.
    console.warn(
      `Sitemap: ${total} published products exceed the ` +
        `${MAX_FETCHABLE_ITEMS} this route can list; the rest are omitted.`,
    );
  }
  return total;
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
