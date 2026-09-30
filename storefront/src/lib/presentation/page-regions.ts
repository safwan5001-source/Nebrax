/**
 * CUST-H2-1 — Page Type Registry + Product/Category region normalization.
 *
 * Twin of `storefront/src/lib/presentation/page-regions.ts`. Keep the two
 * aligned exactly, following the same discipline as `section-content.ts`.
 *
 * `pagePresentation` is the additive, optional namespace added in schema
 * version 3 (`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`). It never
 * touches `homepage` (Home keeps its own existing section model) and never
 * touches `pages` (informational/CMS pages, an unrelated existing key).
 *
 * Region `content` is intentionally always dropped in this slice: no typed
 * per-region content contract exists yet (that is CUST-H2-3/H2-4 scope).
 * Accepting an untyped free-form bag before that contract exists would be
 * the one thing every other normalizer branch in this file refuses to do.
 */

/** Page Type Registry. Expandable later without touching existing page types. */
export const PAGE_TYPES = ["home", "product", "category"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PRODUCT_PAGE_REGION_KEYS = [
  "media_gallery",
  "identity",
  "price",
  "availability",
  "variant_selector",
  "quantity_cta",
  "description",
  "custom_fields",
  "sku_options_details",
] as const;
export type ProductPageRegionKey = (typeof PRODUCT_PAGE_REGION_KEYS)[number];

/**
 * `pagination` appears in the architecture doc's illustrative type alias but
 * has no row in its own detailed Category Page Region Contract table (nor in
 * the CUST-H2-ARCH-1 report's Category Page Region Map summary): pagination
 * is explicitly described there as a property of `product_grid`
 * ("infinite-scroll pagination is commerce-authoritative, not a presentation
 * choice in H2 V1"), not a separate region. A registry entry with no backing
 * capability data (state/requirement/dependency) would violate the very
 * contract this registry exists to enforce, so it is not included here.
 */
export const CATEGORY_PAGE_REGION_KEYS = [
  "breadcrumbs",
  "identity_title",
  "description",
  "subcategories_rail",
  "filter_sort_bar",
  "product_grid",
] as const;
export type CategoryPageRegionKey = (typeof CATEGORY_PAGE_REGION_KEYS)[number];

/**
 * FIXED_REQUIRED regions are forced back to `visible: true` at
 * normalization time — the client picker never offers a way to hide them,
 * but the server does not trust the client not to have sent it anyway.
 *
 * `variant_selector` is deliberately excluded: its FIXED_REQUIRED-ness is
 * conditional on a specific product's `hasVariants`, data the normalizer
 * has no access to (this is a schema/registry document, not tied to any one
 * product). Enforcing that condition is a public-runtime concern for
 * CUST-H2-5, not something the document-level normalizer can decide.
 */
export const FIXED_REQUIRED_PRODUCT_REGION_KEYS: readonly ProductPageRegionKey[] =
  ["media_gallery", "identity", "price", "quantity_cta"];

export const FIXED_REQUIRED_CATEGORY_REGION_KEYS: readonly CategoryPageRegionKey[] =
  ["breadcrumbs", "identity_title", "filter_sort_bar", "product_grid"];

export interface PageRegionInstance<K extends string> {
  id: string;
  key: K;
  visible: boolean;
  /**
   * Always absent in this slice — see the file header. Typed per-region in
   * a later slice; present in the type only so that slice is additive.
   */
  content?: Record<string, unknown>;
}

export interface ProductPagePresentation {
  version: 1;
  regions: PageRegionInstance<ProductPageRegionKey>[];
}

export interface CategoryPagePresentation {
  version: 1;
  regions: PageRegionInstance<CategoryPageRegionKey>[];
}

export interface PagePresentation {
  product?: ProductPagePresentation;
  category?: CategoryPagePresentation;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const text = asString(value, fallback).trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(text) ? text : fallback;
}

function normalizeRegions<K extends string>(
  raw: unknown,
  allowedKeys: readonly K[],
  fixedRequiredKeys: readonly K[],
): PageRegionInstance<K>[] {
  if (!Array.isArray(raw)) return [];

  const out: PageRegionInstance<K>[] = [];
  const seenKeys = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const key = asString(value.key);
    if (!(allowedKeys as readonly string[]).includes(key)) continue;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const isFixedRequired = (fixedRequiredKeys as readonly string[]).includes(key);
    out.push({
      id: safeId(value.id, key),
      key: key as K,
      visible: isFixedRequired ? true : asBoolean(value.visible, false),
    });
  }

  return out;
}

/**
 * Normalizes one page type's presentation sub-document (`{version, regions}`).
 * `null` means "not customized" and must not be written to the document at
 * all — the caller omits the key entirely rather than storing an empty shell.
 */
function normalizePageTypePresentation<K extends string>(
  raw: unknown,
  allowedKeys: readonly K[],
  fixedRequiredKeys: readonly K[],
): { version: 1; regions: PageRegionInstance<K>[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  // Page-content schema evolves independently of the document's top-level
  // `version` (architecture doc, "Normalization"). A declared version above
  // the only one this slice supports fails closed rather than being guessed.
  if (typeof value.version === "number" && value.version > 1) return null;

  return {
    version: 1,
    regions: normalizeRegions(value.regions, allowedKeys, fixedRequiredKeys),
  };
}

/**
 * Normalizes the whole `pagePresentation` namespace. Returns `undefined`
 * when there is nothing to store — absence must stay absence, not an empty
 * `{}` shell, so every pre-CUST-H2 Version keeps normalizing byte-identically.
 */
export function normalizePagePresentation(raw: unknown): PagePresentation | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;

  const product = normalizePageTypePresentation(
    value.product,
    PRODUCT_PAGE_REGION_KEYS,
    FIXED_REQUIRED_PRODUCT_REGION_KEYS,
  );
  const category = normalizePageTypePresentation(
    value.category,
    CATEGORY_PAGE_REGION_KEYS,
    FIXED_REQUIRED_CATEGORY_REGION_KEYS,
  );

  if (!product && !category) return undefined;

  const result: PagePresentation = {};
  if (product) result.product = product;
  if (category) result.category = category;
  return result;
}
