/**
 * FLOWERS-H10 — gifting filters for the product listing.
 *
 * The public product list already returns disjunctive facet and brand counts
 * in `meta` (`CatalogFacetFilter::meta`): each facet's counts ignore that
 * facet's own selection, so a shopper can widen within a dimension, and a
 * selected value stays listed even at count 0. This module only *normalizes*
 * that payload for the UI — it never computes counts, availability or
 * meaning. Anything malformed is dropped rather than repaired.
 */

export interface ListingFacetValue {
  slug: string;
  name: string;
  count: number;
}

export interface ListingFacetGroup {
  /** The merchant facet key (the `facet[<key>]` query parameter). */
  key: string;
  /** `occasion` / `recipient` for the built-in dimensions, else null. */
  systemKey: string | null;
  name: string;
  values: ListingFacetValue[];
}

export interface ListingBrand {
  id: string;
  name: string;
  count: number;
}

export interface ListingFacets {
  groups: ListingFacetGroup[];
  brands: ListingBrand[];
}

export const EMPTY_LISTING_FACETS: ListingFacets = { groups: [], brands: [] };

/** Bounds keep a malformed or hostile payload from flooding the UI. */
export const MAX_FACET_GROUPS = 8;
export const MAX_VALUES_PER_GROUP = 40;
export const MAX_BRANDS = 40;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACET_KEY = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Built-in dimensions are shown first, in this order. */
const SYSTEM_ORDER = ["occasion", "recipient"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function localized(name: unknown, nameEn: unknown, locale: string) {
  const en = text(nameEn);
  return locale.toLowerCase().startsWith("en") && en ? en : text(name);
}

function parseValues(raw: unknown, locale: string): ListingFacetValue[] {
  if (!Array.isArray(raw)) return [];
  const values: ListingFacetValue[] = [];
  for (const entry of raw) {
    if (values.length >= MAX_VALUES_PER_GROUP) break;
    if (!isRecord(entry)) continue;
    const slug = text(entry.slug);
    const name = localized(entry.name, entry.name_en, locale);
    const count = entry.count;
    if (
      !slug ||
      !SLUG.test(slug) ||
      !name ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0
    ) {
      continue;
    }
    // A zero-count value is only useful while it is selected (so it can be
    // removed); the API already omits other empty values.
    if (count === 0 && entry.selected !== true) continue;
    values.push({ slug, name, count: Math.trunc(count) });
  }
  return values;
}

export function parseListingFacets(
  meta: { facets?: unknown; brands?: unknown } | null | undefined,
  locale: string,
): ListingFacets {
  const groups: ListingFacetGroup[] = [];
  const seen = new Set<string>();
  if (Array.isArray(meta?.facets)) {
    for (const row of meta.facets) {
      if (groups.length >= MAX_FACET_GROUPS) break;
      if (!isRecord(row)) continue;
      const key = text(row.key);
      const name = localized(row.name, row.name_en, locale);
      if (!key || !FACET_KEY.test(key) || !name || seen.has(key)) continue;
      const values = parseValues(row.values, locale);
      if (values.length === 0) continue;
      seen.add(key);
      const systemKey = text(row.system_key);
      groups.push({ key, systemKey, name, values });
    }
  }
  groups.sort((a, b) => {
    const ai = SYSTEM_ORDER.indexOf(a.systemKey as never);
    const bi = SYSTEM_ORDER.indexOf(b.systemKey as never);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const brands: ListingBrand[] = [];
  if (Array.isArray(meta?.brands)) {
    for (const row of meta.brands) {
      if (brands.length >= MAX_BRANDS) break;
      if (!isRecord(row)) continue;
      const id = text(row.id);
      const name = text(row.name);
      const count = row.count;
      if (
        !id ||
        !UUID.test(id) ||
        !name ||
        typeof count !== "number" ||
        !Number.isFinite(count) ||
        count < 0 ||
        // The selected brand stays listed at 0 so it can be removed.
        (count === 0 && row.selected !== true)
      ) {
        continue;
      }
      brands.push({ id, name, count: Math.trunc(count) });
    }
  }

  return { groups, brands };
}

export function hasListingFacets(facets: ListingFacets): boolean {
  return facets.groups.length > 0 || facets.brands.length > 0;
}
