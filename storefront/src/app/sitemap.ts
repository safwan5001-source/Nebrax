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
  resolveSitemapBaseUrl,
  type SitemapCategory,
  type SitemapProduct,
  type SitemapProductPage,
} from "@/lib/data/sitemap";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

export const dynamic = "force-dynamic";

type CountryLocale = MarketLocaleTarget;

/**
 * The published catalog behind a storefront host. AWJ serves one catalog per
 * host whatever the locale (ids are language-neutral), so it is read once and
 * shared by every country/locale target.
 */
interface Catalog {
  productCount: number;
  categories: SitemapCategory[];
}

/** Per-request memo of product pages; never shared across requests or hosts. */
type ProductPages = Map<number, Promise<SitemapProductPage>>;

/**
 * Google permits 50,000 URLs, but 10,000 keeps each request below roughly 100
 * Store API pages and avoids long-running sitemap responses on large catalogs.
 */
const URLS_PER_SITEMAP = 10_000;
/** Home and the product listing. `/c` has no page of its own, so it is not listed. */
const STATIC_PAGES_PER_LOCALE = 2;
const ITEMS_PER_PAGE = 100;
const MAX_PAGES = 1000;
const MAX_CONCURRENT_PAGE_REQUESTS = 8;
/** Maximum items we can actually fetch, given pagination limits. */
const MAX_FETCHABLE_ITEMS = ITEMS_PER_PAGE * MAX_PAGES;

const UNAVAILABLE_MESSAGE = "Sitemap is temporarily unavailable.";

/**
 * Splits the sitemap into bounded files. Only counts are read here (a single
 * product row and the category tree); no catalog page is loaded. A failure
 * degrades to one chunk — it must never take robots.txt down with it.
 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  try {
    const countryLocales = await resolveCountryLocales();
    const catalog = await loadCatalog(async () => getSitemapProductPage(1, 1));
    const totalUrls = countryLocales.length * catalogSize(catalog);
    const sitemapCount = Math.max(1, Math.ceil(totalUrls / URLS_PER_SITEMAP));

    return Array.from({ length: sitemapCount }, (_, id) => ({ id }));
  } catch (error) {
    // API may be unavailable (build time, outage). Return a single sitemap
    // chunk; it is populated on demand when the API recovers.
    console.error(
      `Sitemap index fell back to a single chunk: ${describeSitemapFailure(error)}`,
    );
    return [{ id: 0 }];
  }
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  if (!Number.isSafeInteger(id) || id < 0) return [];

  try {
    return await buildSitemapChunk(id);
  } catch (error) {
    // A failed read must not become a 200 sitemap that looks authoritative but
    // silently lacks products. Log the detail server-side and answer with a
    // generic 5xx so crawlers retry and monitoring sees it.
    console.error(
      `Sitemap chunk ${id} failed: ${describeSitemapFailure(error)}`,
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

  const countryLocales = await resolveCountryLocales();
  const pages: ProductPages = new Map();
  const catalog = await loadCatalog(() => getProductPage(pages, 1));

  const chunkStart = id * URLS_PER_SITEMAP;
  const chunkEnd = chunkStart + URLS_PER_SITEMAP;
  const entries: MetadataRoute.Sitemap = [];
  let targetStart = 0;

  for (const target of countryLocales) {
    const targetEnd = targetStart + catalogSize(catalog);
    if (targetEnd <= chunkStart) {
      targetStart = targetEnd;
      continue;
    }
    if (targetStart >= chunkEnd) break;

    const basePath = `${baseUrl}/${target.country}/${target.locale}`;
    appendStaticEntries(entries, basePath, targetStart, chunkStart, chunkEnd);

    const productStart = targetStart + STATIC_PAGES_PER_LOCALE;
    const productEnd = productStart + catalog.productCount;
    const categoryStart = productEnd;
    const categoryEnd = categoryStart + catalog.categories.length;

    const productRange = intersectRange(
      productStart,
      productEnd,
      chunkStart,
      chunkEnd,
    );
    const categoryRange = intersectRange(
      categoryStart,
      categoryEnd,
      chunkStart,
      chunkEnd,
    );

    if (productRange) {
      const products = await fetchProductRange(
        pages,
        productRange.start - productStart,
        productRange.end - productStart,
      );
      appendProductEntries(entries, baseUrl, basePath, products);
    }
    if (categoryRange) {
      appendCategoryEntries(
        entries,
        basePath,
        catalog.categories.slice(
          categoryRange.start - categoryStart,
          categoryRange.end - categoryStart,
        ),
      );
    }

    targetStart = targetEnd;
  }

  return entries;
}

/**
 * Reads the catalog totals. `readFirstProductPage` decides how much of the
 * first product page is loaded: the index asks for one row, a chunk loads (and
 * memoises) the full first page so it is not fetched twice.
 */
async function loadCatalog(
  readFirstProductPage: () => Promise<SitemapProductPage>,
): Promise<Catalog> {
  const [firstPage, categories] = await Promise.all([
    readFirstProductPage(),
    getSitemapCategories(),
  ]);

  if (firstPage.total > MAX_FETCHABLE_ITEMS) {
    // Announced, never silent: these products cannot be listed by this route.
    console.warn(
      `Sitemap: ${firstPage.total} published products exceed the ` +
        `${MAX_FETCHABLE_ITEMS} this route can list; the rest are omitted.`,
    );
  }

  return {
    productCount: Math.min(firstPage.total, MAX_FETCHABLE_ITEMS),
    categories,
  };
}

function catalogSize(catalog: Catalog): number {
  return (
    STATIC_PAGES_PER_LOCALE + catalog.productCount + catalog.categories.length
  );
}

function intersectRange(
  rangeStart: number,
  rangeEnd: number,
  chunkStart: number,
  chunkEnd: number,
): { start: number; end: number } | undefined {
  const start = Math.max(rangeStart, chunkStart);
  const end = Math.min(rangeEnd, chunkEnd);
  return start < end ? { start, end } : undefined;
}

function appendStaticEntries(
  entries: MetadataRoute.Sitemap,
  basePath: string,
  targetStart: number,
  chunkStart: number,
  chunkEnd: number,
): void {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: basePath, changeFrequency: "daily", priority: 1 },
    {
      url: `${basePath}/products`,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  for (const [offset, entry] of staticEntries.entries()) {
    const position = targetStart + offset;
    if (position >= chunkStart && position < chunkEnd) entries.push(entry);
  }
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

function getProductPage(
  pages: ProductPages,
  page: number,
): Promise<SitemapProductPage> {
  let cached = pages.get(page);
  if (!cached) {
    cached = getSitemapProductPage(page, ITEMS_PER_PAGE).catch((error) => {
      pages.delete(page);
      throw error;
    });
    pages.set(page, cached);
  }
  return cached;
}

async function fetchProductRange(
  pages: ProductPages,
  start: number,
  end: number,
): Promise<SitemapProduct[]> {
  if (start >= end) return [];

  const firstPage = Math.floor(start / ITEMS_PER_PAGE) + 1;
  const lastPage = Math.ceil(end / ITEMS_PER_PAGE);
  const pageNumbers = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
  const items: SitemapProduct[] = [];

  for (
    let offset = 0;
    offset < pageNumbers.length;
    offset += MAX_CONCURRENT_PAGE_REQUESTS
  ) {
    const batch = pageNumbers.slice(
      offset,
      offset + MAX_CONCURRENT_PAGE_REQUESTS,
    );
    const results = await Promise.all(
      batch.map((page) => getProductPage(pages, page)),
    );
    for (const [index, result] of results.entries()) {
      warnOnShortPage(batch[index], result);
      items.push(...result.items);
    }
  }

  const loadedRangeStart = (firstPage - 1) * ITEMS_PER_PAGE;
  return items.slice(start - loadedRangeStart, end - loadedRangeStart);
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
