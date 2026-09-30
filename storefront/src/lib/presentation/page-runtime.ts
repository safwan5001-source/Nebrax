/**
 * CUST-H2-5 — Public runtime resolution of `pagePresentation.{product,category}`.
 *
 * Closes the chain the architecture doc's "Public Runtime Mapping" describes:
 * Customizer → `pagePresentation` → Version Draft → Published Snapshot →
 * this module → the real Product/Category page components. Everything here
 * reads the already-published, already-twice-normalized config
 * (`readPublishedPresentation` → `normalizePresentationConfig` →
 * `normalizePagePresentation`) — it never reaches Draft, never accepts a
 * client-supplied Version/Storefront id, and issues no additional request of
 * its own (the presentation document already arrived with the same
 * `fetchStorefrontConfig()` call the storefront shell/layout already makes
 * once per request).
 *
 * **Why a second safety pass on top of an already-normalized document:** the
 * normalizer (PHP + this package's own `page-regions.ts` twin) drops unknown
 * keys, de-duplicates by key, and forces a FIXED_REQUIRED entry that IS
 * present back to `visible: true` — but it does not re-insert a
 * FIXED_REQUIRED entry that is missing from the stored `regions` array
 * outright, because the Customizer UI never produces that shape (there is no
 * delete affordance for a FIXED_REQUIRED region, only visibility toggling on
 * the optional ones). The public renderer must not trust that invariant
 * blindly — "do not trust arbitrary client payloads" applies just as much to
 * a stored document a future bug or a direct data edit could shape
 * differently. `mergeRegionsFailSafe` below is the one place that guarantees
 * Add-to-Cart, price, the product grid, breadcrumbs, etc. can never disappear
 * from the published page, however the stored array is shaped.
 */

import {
  CATEGORY_PAGE_REGION_KEYS,
  type CategoryPageRegionKey,
  FIXED_REQUIRED_CATEGORY_REGION_KEYS,
  FIXED_REQUIRED_PRODUCT_REGION_KEYS,
  type PagePresentation,
  type PageRegionInstance,
  PRODUCT_PAGE_REGION_KEYS,
  type ProductPageRegionKey,
} from "./page-regions";

/**
 * Merges a stored (already-normalized) region array against a page type's
 * canonical contract. Keeps only known keys, de-duplicates defensively (the
 * normalizer already guarantees this, but a second, cheap check costs
 * nothing and this function must hold its own invariant regardless of what
 * called it). When every `mustPresentKeys` entry is already present, the
 * merchant's own authored order/visibility is returned untouched. Only when
 * a commerce-critical region is missing outright does this fall back to the
 * full canonical order — a shape the Customizer never actually produces, so
 * this branch trades a merchant's (impossible, in practice) authored order
 * for the one guarantee that matters: the region is never simply gone.
 */
function mergeRegionsFailSafe<K extends string>(
  stored: readonly PageRegionInstance<K>[] | undefined,
  canonicalKeys: readonly K[],
  mustPresentKeys: readonly K[],
): PageRegionInstance<K>[] {
  const seen = new Set<string>();
  const kept: PageRegionInstance<K>[] = [];
  for (const region of stored ?? []) {
    if (!region || typeof region !== "object") continue;
    if (!(canonicalKeys as readonly string[]).includes(region.key)) continue;
    if (seen.has(region.key)) continue;
    seen.add(region.key);
    kept.push(region);
  }

  const missingRequired = mustPresentKeys.filter((key) => !seen.has(key));
  if (missingRequired.length === 0) return kept;

  return canonicalKeys.map(
    (key) =>
      kept.find((region) => region.key === key) ?? {
        id: key,
        key,
        visible: true,
      },
  );
}

/**
 * Final, ordered, visible-only Product region keys for the Product currently
 * being rendered. `hasVariants` is the caller's own real, current-request
 * data-dependency check (the same condition the real page already uses to
 * decide whether to render `VariantPicker` at all) — never persisted, never
 * read from `pagePresentation` itself (architecture doc, "Product
 * Conditional Semantics": `variant_selector` is authored once, independent
 * of which Product a shopper happens to be viewing).
 *
 * `variant_selector` is force-visible whenever `hasVariants` is true, even
 * if the stored entry itself carries `visible: false` — the Customizer's own
 * registry marks it `canHide: false`/`canDelete: false` and offers no
 * affordance to store that shape, but the public renderer does not trust
 * that invariant blindly (same posture as every other FIXED_REQUIRED
 * region): "If Product has variants: render the required variant selector
 * ... regardless of layout instance presence."
 */
export function resolvePublicProductRegions(
  pagePresentation: PagePresentation | undefined,
  hasVariants: boolean,
): ProductPageRegionKey[] {
  const mustPresent: readonly ProductPageRegionKey[] = hasVariants
    ? [...FIXED_REQUIRED_PRODUCT_REGION_KEYS, "variant_selector"]
    : FIXED_REQUIRED_PRODUCT_REGION_KEYS;

  const merged = mergeRegionsFailSafe(
    pagePresentation?.product?.regions,
    PRODUCT_PAGE_REGION_KEYS,
    mustPresent,
  );

  return merged
    .map((region) =>
      hasVariants && region.key === "variant_selector" && !region.visible
        ? { ...region, visible: true }
        : region,
    )
    .filter(
      (region) =>
        region.visible && (region.key !== "variant_selector" || hasVariants),
    )
    .map((region) => region.key);
}

/** Final, ordered, visible-only Category region keys for the current request. */
export function resolvePublicCategoryRegions(
  pagePresentation: PagePresentation | undefined,
): CategoryPageRegionKey[] {
  const merged = mergeRegionsFailSafe(
    pagePresentation?.category?.regions,
    CATEGORY_PAGE_REGION_KEYS,
    FIXED_REQUIRED_CATEGORY_REGION_KEYS,
  );

  return merged.filter((region) => region.visible).map((region) => region.key);
}
