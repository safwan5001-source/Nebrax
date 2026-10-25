import { headers } from "next/headers";
import { StorefrontApiError, storefrontFetch } from "@/lib/commerce/config";
import { toRenderableMediaUrl } from "@/lib/commerce/mappers";
import type {
  AwjCategory,
  AwjListResponse,
  AwjProduct,
} from "@/lib/commerce/types";
import { getMarkets } from "@/lib/data/markets";
import { getStoreUrl } from "@/lib/store";

/**
 * X3 — sitemap data, read from the AWJ Store public catalog API (`store/v1`).
 *
 * Source contracts (verified against the Laravel controllers, not assumed):
 *  - `GET products` — only `is_active` products with a PUBLISHED `CommerceListing`
 *    on the sales channel resolved from the request host; `per_page` ≤ 100;
 *    `meta.pagination.total` is the full published count; stable order
 *    (`name`, then `id` desc as the tie-breaker). The listing carries
 *    `updated_at` and `thumbnail_url` but NOT the gallery (`media` is detail-only).
 *  - `GET categories` — one unpaginated tree (active AND published categories
 *    only), roots with `children` nested two levels deep. Carries no timestamps.
 *
 * Tenant isolation: every request goes through `storefrontFetch()`, which
 * forwards the visitor's real Host so the backend resolves tenant and channel.
 * Nothing here is cached across requests (no `"use cache"`, no module state):
 * a cache key that omits the host would serve one tenant's catalog to another.
 *
 * This module deliberately has no `"use server"` directive — its exports are
 * server-internal readers, not callable server actions.
 */

const SITEMAP_PRODUCTS_PAGE_SIZE_MAX = 100;

/**
 * Sitemap layout — shaped by the upstream request budget, not by URL count.
 * A file covers a FIXED number of product API pages, so its cost is known
 * before it starts:
 *   file 0   = static pages + every category + product pages 1..N
 *   file k>0 = product pages kN+1..(k+1)N
 */
export const PRODUCT_PAGES_PER_SITEMAP = 5;
export const ITEMS_PER_PAGE = 100;
export const MAX_PAGES = 1000;
/** Maximum products we can actually list, given pagination limits. */
export const MAX_FETCHABLE_ITEMS = ITEMS_PER_PAGE * MAX_PAGES;
export const MAX_SITEMAPS = Math.ceil(MAX_PAGES / PRODUCT_PAGES_PER_SITEMAP);
/** The index reads one product row for the total; the locale lookup is not needed. */
export const SITEMAP_INDEX_REQUESTS = 1;

/**
 * Upstream request budget.
 *
 * `store/v1` catalog routes sit behind `EnforcePublicApiRateLimit:unauth`:
 * 30 requests per fixed 60 s window, keyed by `sha1(client IP)` — here the
 * Next.js server's IP, so the budget is SHARED by every tenant this server
 * fronts and by every live storefront read. A sitemap that spends it starves
 * shoppers. Batching or concurrency does not help: each request counts.
 *
 * The sitemap therefore (a) plans its request count up front and (b) may spend
 * at most `DEFAULT_BUDGET_PER_MINUTE` of the 30 in any 60 s window per server
 * process (override: `SITEMAP_UPSTREAM_BUDGET_PER_MINUTE`). Over budget it
 * fails closed WITHOUT calling the API. A 429 from the API starts a cool-down
 * for its `Retry-After` (capped at one window). There are no retries; the
 * crawler is the retry loop. Only counters live here — never catalog data —
 * so nothing crosses tenants.
 */
const BUDGET_WINDOW_MS = 60_000;
const DEFAULT_BUDGET_PER_MINUTE = 15;

const budget = { windowStart: 0, used: 0, cooldownUntil: 0 };

/** The sitemap may not call the API right now; carries the wait in seconds. */
export class SitemapBudgetError extends Error {
  constructor(
    readonly reason: "budget" | "cooldown",
    readonly retryAfterSeconds: number,
  ) {
    super(`Sitemap upstream ${reason} exhausted.`);
    this.name = "SitemapBudgetError";
  }
}

function readBudgetPerMinute(): number {
  const configured = Number(process.env.SITEMAP_UPSTREAM_BUDGET_PER_MINUTE);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_BUDGET_PER_MINUTE;
}

/** Reserve `count` upstream requests for one sitemap invocation, or throw. */
export function reserveSitemapRequests(count: number): void {
  const now = Date.now();
  if (now < budget.cooldownUntil) {
    throw new SitemapBudgetError(
      "cooldown",
      Math.ceil((budget.cooldownUntil - now) / 1000),
    );
  }
  if (now - budget.windowStart >= BUDGET_WINDOW_MS) {
    budget.windowStart = now;
    budget.used = 0;
  }
  if (budget.used + count > readBudgetPerMinute()) {
    throw new SitemapBudgetError(
      "budget",
      Math.max(
        1,
        Math.ceil((budget.windowStart + BUDGET_WINDOW_MS - now) / 1000),
      ),
    );
  }
  budget.used += count;
}

async function guardRateLimit<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 429) {
      const wait = Math.min(error.retryAfterSeconds ?? 60, 60);
      budget.cooldownUntil = Date.now() + wait * 1000;
    }
    throw error;
  }
}

export interface SitemapProduct {
  id: string;
  /** ISO-8601 timestamp from the API, when present and valid. */
  updated_at: string | null;
  /** Primary image as a renderable same-origin path (or absolute URL). */
  image_url: string | null;
}

export interface SitemapCategory {
  id: string;
}

export interface SitemapProductPage {
  items: SitemapProduct[];
  /** Total published products across all pages, as reported by the API. */
  total: number;
}

/** Raised when the API answers with something that is not the documented shape. */
export class SitemapSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SitemapSourceError";
  }
}

export type SitemapMarkets = Awaited<ReturnType<typeof getMarkets>>["data"];

/** AWJ's single static Market (countries × supported locales). No Spree call. */
export async function getSitemapMarkets(): Promise<SitemapMarkets> {
  return (await getMarkets()).data;
}

function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function readTotal(response: AwjListResponse<unknown>): number {
  const total = response?.meta?.pagination?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new SitemapSourceError("Catalog response has no valid total.");
  }
  return Math.floor(total);
}

function readImageUrl(product: AwjProduct): string | null {
  const url = toRenderableMediaUrl(
    typeof product.thumbnail_url === "string" ? product.thumbnail_url : null,
  );
  return url && url.trim() !== "" ? url : null;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * One page of published products. Pass `perPage = 1` to read only the total
 * (the cheapest call the API offers for a count).
 */
export async function getSitemapProductPage(
  page: number,
  perPage: number,
): Promise<SitemapProductPage> {
  const response = await guardRateLimit(() =>
    storefrontFetch<AwjListResponse<AwjProduct>>("products", {
      page,
      per_page: Math.min(Math.max(1, perPage), SITEMAP_PRODUCTS_PAGE_SIZE_MAX),
    }),
  );
  if (!Array.isArray(response?.data)) {
    throw new SitemapSourceError("Catalog response has no product list.");
  }

  return {
    total: readTotal(response),
    items: response.data
      .filter((product) => isUsableId(product?.id))
      .map((product) => ({
        id: product.id,
        updated_at: readTimestamp(product.updated_at),
        image_url: readImageUrl(product),
      })),
  };
}

function flattenCategories(
  nodes: AwjCategory[],
  seen: Set<string>,
  out: SitemapCategory[],
): void {
  for (const node of nodes) {
    if (!isUsableId(node?.id) || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push({ id: node.id });
    if (Array.isArray(node.children)) {
      flattenCategories(node.children, seen, out);
    }
  }
}

/**
 * Every published category, parents before children, de-duplicated.
 *
 * Unlike the Spree storefront, AWJ's top-level categories are real, routable
 * categories (`/c/{id}` resolves them) — they are NOT a synthetic root to skip.
 */
export async function getSitemapCategories(): Promise<SitemapCategory[]> {
  const response = await guardRateLimit(() =>
    storefrontFetch<AwjListResponse<AwjCategory>>("categories"),
  );
  if (!Array.isArray(response?.data)) {
    throw new SitemapSourceError("Category response has no category list.");
  }

  const categories: SitemapCategory[] = [];
  flattenCategories(response.data, new Set(), categories);
  return categories;
}

const HOST_PATTERN =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;

function parseStoreBase(
  raw: string | undefined,
): { base: string; host: string } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw.replace(/\/$/, ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return {
      base: parsed.origin + parsed.pathname.replace(/\/$/, ""),
      host: parsed.host.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

/**
 * The absolute base URL the sitemap and robots.txt must advertise, derived
 * from the host the crawler actually reached — the same host the backend uses
 * to resolve the tenant — so one tenant's sitemap can never name another
 * tenant's domain.
 *
 * When the configured store URL (`NEXT_PUBLIC_SITE_URL`) is for the same host
 * it wins, so sitemap URLs keep agreeing with the page canonicals byte for
 * byte. Otherwise the origin is rebuilt from the request host. A host that does
 * not look like a hostname is ignored (it would be reflected into XML/robots).
 * Returns `undefined` when neither is usable.
 */
export async function resolveSitemapBaseUrl(): Promise<string | undefined> {
  const configured = parseStoreBase(getStoreUrl());

  let host: string | undefined;
  let forwardedProto: string | undefined;
  try {
    const requestHeaders = await headers();
    const raw = requestHeaders.get("host")?.trim().toLowerCase();
    host = raw && HOST_PATTERN.test(raw) ? raw : undefined;
    forwardedProto = requestHeaders
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase();
  } catch {
    host = undefined;
  }

  if (!host) return configured?.base;
  if (configured && configured.host === host) return configured.base;

  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : process.env.NODE_ENV === "production"
        ? "https"
        : "http";
  return `${protocol}://${host}`;
}

/** Server-log description of a failure; never sent to a visitor. */
export function describeSitemapFailure(error: unknown): string {
  if (error instanceof StorefrontApiError) {
    return error.retryAfterSeconds
      ? `AWJ API ${error.status} (${error.code}), retry after ${error.retryAfterSeconds}s`
      : `AWJ API ${error.status} (${error.code})`;
  }
  if (error instanceof SitemapBudgetError) {
    return `upstream ${error.reason} exhausted, retry after ${error.retryAfterSeconds}s`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 300);
  }
  return "unknown error";
}

export function announceTruncation(total: number): number {
  if (total > MAX_FETCHABLE_ITEMS) {
    // Announced, never silent: these products cannot be listed by this route.
    console.warn(
      `Sitemap: ${total} published products exceed the ` +
        `${MAX_FETCHABLE_ITEMS} this route can list; the rest are omitted.`,
    );
  }
  return total;
}

/**
 * The sitemap files that exist for the current host. Throws when the catalog
 * total cannot be read (API down, rate limit, exhausted request budget): a list
 * that is "probably right" is wrong — Next's metadata loader answers 404 for
 * any id missing from it, and a temporary failure must stay a retryable 5xx.
 */
export async function listSitemapIds(): Promise<Array<{ id: number }>> {
  reserveSitemapRequests(SITEMAP_INDEX_REQUESTS);
  const total = Math.min(
    announceTruncation((await getSitemapProductPage(1, 1)).total),
    MAX_FETCHABLE_ITEMS,
  );
  const count = Math.max(
    1,
    Math.ceil(total / (PRODUCT_PAGES_PER_SITEMAP * ITEMS_PER_PAGE)),
  );
  return Array.from({ length: count }, (_, id) => ({ id }));
}

/**
 * robots.txt discovery only: advertise what we can verify, else the first file.
 * Never used for chunk validation — a wrong answer here costs a crawl hint, a
 * wrong answer there is a false 404.
 */
export async function listSitemapIdsForRobots(): Promise<
  Array<{ id: number }>
> {
  try {
    return await listSitemapIds();
  } catch (error) {
    console.error(
      `robots.txt lists a single sitemap file: ${describeSitemapFailure(error)}`,
    );
    return [{ id: 0 }];
  }
}
