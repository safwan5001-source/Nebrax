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
  const response = await storefrontFetch<AwjListResponse<AwjProduct>>(
    "products",
    {
      page,
      per_page: Math.min(Math.max(1, perPage), SITEMAP_PRODUCTS_PAGE_SIZE_MAX),
    },
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
  const response =
    await storefrontFetch<AwjListResponse<AwjCategory>>("categories");
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
    return `AWJ API ${error.status} (${error.code})`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 300);
  }
  return "unknown error";
}
