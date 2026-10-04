import type { ProductListParams } from "@spree/sdk";

/**
 * FLOWERS-H9b / ADR-21 — catalog context carried by a listing URL when it is
 * reached from a data-backed home section (shelf "view all", discovery tile):
 * a collection, facet values, a brand and/or the derived "deliver today"
 * switch. These are *forwarded to the public product list as-is* — the
 * backend remains the only authority on what they mean; an unknown slug just
 * yields an empty list (fail closed). The listing's own filter state
 * (`q`, `sort`, price …) lives separately in `listing-search-params.ts` and
 * its URL rewrites preserve these keys (they are not listing-owned).
 *
 * Tokens are validated here only to keep malformed input out of the upstream
 * request, never to decide meaning.
 */
export interface ListingContext {
  collection?: string;
  /** facet key → comma-separated slugs (the API's OR-within-dimension form). */
  facets: Record<string, string>;
  brandId?: string;
  deliverToday: boolean;
}

/**
 * Extra list params understood by the AWJ product list beyond Spree's
 * (`collection`, `brand_id`, `deliver_today`, flat `facet[<key>]` entries —
 * the PHP array-query form). `ProductListParams`' own flat index signature
 * already admits them, so this is an alias, not a new shape.
 */
export type ListingContextParams = ProductListParams;

export type StorefrontListParams = ProductListParams;

type RawSearchParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACET_KEY = /^facet\[([a-z0-9]+(?:[-_][a-z0-9]+)*)\]$/;
const MAX_FACETS = 8;
const MAX_SLUGS = 20;

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function slugList(value: string): string | null {
  const slugs = value
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0 || slugs.length > MAX_SLUGS) return null;
  return slugs.every((slug) => SLUG.test(slug)) ? slugs.join(",") : null;
}

export function parseListingContext(raw: RawSearchParams): ListingContext {
  const collectionRaw = first(raw, "collection");
  const brandRaw = first(raw, "brand_id");
  const deliverRaw = first(raw, "deliver_today")?.toLowerCase();

  const facets: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    const match = FACET_KEY.exec(key);
    if (!match || Object.keys(facets).length >= MAX_FACETS) continue;
    const slugs = slugList(first(raw, key) ?? "");
    if (slugs) facets[match[1]] = slugs;
  }

  return {
    ...(collectionRaw && SLUG.test(collectionRaw)
      ? { collection: collectionRaw }
      : {}),
    facets,
    ...(brandRaw && UUID.test(brandRaw) ? { brandId: brandRaw } : {}),
    deliverToday: deliverRaw === "true" || deliverRaw === "1",
  };
}

export function hasListingContext(context: ListingContext): boolean {
  return (
    context.collection !== undefined ||
    context.brandId !== undefined ||
    context.deliverToday ||
    Object.keys(context.facets).length > 0
  );
}

/** Params merged into every products fetch of the listing (page 1 and load-more). */
export function listingContextParams(
  context: ListingContext,
): ListingContextParams {
  const params: ListingContextParams = {
    ...(context.collection ? { collection: context.collection } : {}),
    ...(context.brandId ? { brand_id: context.brandId } : {}),
    ...(context.deliverToday ? { deliver_today: true } : {}),
  };
  for (const [key, slugs] of Object.entries(context.facets)) {
    params[`facet[${key}]`] = slugs;
  }
  return params;
}
