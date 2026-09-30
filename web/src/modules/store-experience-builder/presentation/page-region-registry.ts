import {
  CATEGORY_PAGE_REGION_KEYS,
  FIXED_REQUIRED_CATEGORY_REGION_KEYS,
  FIXED_REQUIRED_PRODUCT_REGION_KEYS,
  PRODUCT_PAGE_REGION_KEYS,
  type CategoryPageRegionKey,
  type PageType,
  type ProductPageRegionKey,
} from "./page-regions";

/**
 * CUST-H2-1 — Page Capability Registry (architecture doc, "Page Capability
 * Registry"). Customizer-side only (Home's editor-facing equivalent is
 * `section-capabilities.ts`, also not mirrored to `storefront/`): the public
 * storefront does not run the Customizer and has no need of
 * `previewRenderer`/`publishedRenderer` naming or picker-facing metadata.
 *
 * `allowedPageTypes`, `maxInstances`, and `canDuplicate` are derived from the
 * same closed key lists `page-regions.ts` uses to normalize the document, so
 * there is exactly one place that enumerates "what regions exist for this
 * page type" — this registry and the normalizer can never drift apart.
 *
 * `responsiveConstraints` and `accessibilityRequirements` are left `null`
 * for every region: per-region responsive/accessibility verification is
 * CUST-H2-2+ work (Playwright evidence, per the architecture doc's own
 * Responsive/Accessibility sections), not something this schema-only slice
 * can honestly claim yet.
 */
export interface PageRegionCapability {
  key: string;
  allowedPageTypes: PageType[];
  state: "LIVE" | "DESIGN_ONLY" | "GATED" | "DEFERRED";
  requirement:
    | "FIXED_REQUIRED"
    | "OPTIONAL_TOGGLE"
    | "REORDERABLE"
    | "CONFIGURABLE"
    | "GATED"
    | "DEFERRED";
  maxInstances: number | null;
  canDuplicate: boolean;
  canDelete: boolean;
  canHide: boolean;
  requiredDataDependency: string | null;
  fallbackBehavior: "omit" | "show_disabled" | "show_placeholder";
  responsiveConstraints: string | null;
  accessibilityRequirements: string | null;
  /** Component name the Customizer Canvas will use (CUST-H2-3/H2-4). */
  previewRenderer: string;
  /** Component name the public Next.js page already uses today. */
  publishedRenderer: string;
}

function capability(
  key: ProductPageRegionKey | CategoryPageRegionKey,
  allowedPageTypes: PageType[],
  partial: Pick<
    PageRegionCapability,
    | "requirement"
    | "requiredDataDependency"
    | "fallbackBehavior"
    | "previewRenderer"
    | "publishedRenderer"
  > & { fixedRequired: boolean },
): PageRegionCapability {
  const { fixedRequired, ...rest } = partial;
  return {
    key,
    allowedPageTypes,
    state: "LIVE",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: !fixedRequired,
    canHide: !fixedRequired,
    responsiveConstraints: null,
    accessibilityRequirements: null,
    ...rest,
  };
}

const PRODUCT: Record<ProductPageRegionKey, PageRegionCapability> = {
  media_gallery: capability("media_gallery", ["product"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: "product.media",
    fallbackBehavior: "show_placeholder",
    previewRenderer: "MediaGallery",
    publishedRenderer: "MediaGallery",
  }),
  identity: capability("identity", ["product"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: "product.name",
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline title/WishlistButton/ShareButton)",
    publishedRenderer: "ProductDetails (inline title/WishlistButton/ShareButton)",
  }),
  price: capability("price", ["product"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: "product.price",
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline price/compare-at, HiddenPricePrompt)",
    publishedRenderer: "ProductDetails (inline price/compare-at, HiddenPricePrompt)",
  }),
  availability: capability("availability", ["product"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "product.in_stock",
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline stock indicator)",
    publishedRenderer: "ProductDetails (inline stock indicator)",
  }),
  variant_selector: capability("variant_selector", ["product"], {
    fixedRequired: true,
    requirement: "GATED",
    requiredDataDependency: "product.hasVariants",
    fallbackBehavior: "omit",
    previewRenderer: "VariantPicker",
    publishedRenderer: "VariantPicker",
  }),
  quantity_cta: capability("quantity_cta", ["product"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: null,
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline QuantityPickerField + Add-to-cart)",
    publishedRenderer: "ProductDetails (inline QuantityPickerField + Add-to-cart)",
  }),
  description: capability("description", ["product"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "product.description",
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline plain-text description)",
    publishedRenderer: "ProductDetails (inline plain-text description)",
  }),
  custom_fields: capability("custom_fields", ["product"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "product.custom_fields",
    fallbackBehavior: "omit",
    previewRenderer: "ProductCustomFields",
    publishedRenderer: "ProductCustomFields",
  }),
  sku_options_details: capability("sku_options_details", ["product"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "product.sku",
    fallbackBehavior: "omit",
    previewRenderer: "ProductDetails (inline SKU/options text)",
    publishedRenderer: "ProductDetails (inline SKU/options text)",
  }),
};

const CATEGORY: Record<CategoryPageRegionKey, PageRegionCapability> = {
  breadcrumbs: capability("breadcrumbs", ["category"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: "category.ancestors",
    fallbackBehavior: "omit",
    previewRenderer: "Breadcrumbs",
    publishedRenderer: "Breadcrumbs",
  }),
  identity_title: capability("identity_title", ["category"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: "category.name",
    fallbackBehavior: "omit",
    previewRenderer: "CategoryBanner (inline title)",
    publishedRenderer: "CategoryBanner (inline title)",
  }),
  description: capability("description", ["category"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "category.description",
    fallbackBehavior: "omit",
    previewRenderer: "CategoryBanner (inline description)",
    publishedRenderer: "CategoryBanner (inline description)",
  }),
  subcategories_rail: capability("subcategories_rail", ["category"], {
    fixedRequired: false,
    requirement: "OPTIONAL_TOGGLE",
    requiredDataDependency: "category.children",
    fallbackBehavior: "omit",
    previewRenderer: "CategoryBanner (inline subcategory rail)",
    publishedRenderer: "CategoryBanner (inline subcategory rail)",
  }),
  filter_sort_bar: capability("filter_sort_bar", ["category"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: null,
    fallbackBehavior: "omit",
    previewRenderer: "ListingFilterBar",
    publishedRenderer: "ListingFilterBar",
  }),
  product_grid: capability("product_grid", ["category"], {
    fixedRequired: true,
    requirement: "FIXED_REQUIRED",
    requiredDataDependency: null,
    fallbackBehavior: "show_placeholder",
    previewRenderer: "InfiniteProductList",
    publishedRenderer: "InfiniteProductList",
  }),
};

export const PAGE_REGION_REGISTRY: Record<
  PageType,
  Record<string, PageRegionCapability>
> = {
  home: {},
  product: PRODUCT,
  category: CATEGORY,
};

export function pageRegionCapability(
  pageType: "product",
  key: ProductPageRegionKey,
): PageRegionCapability;
export function pageRegionCapability(
  pageType: "category",
  key: CategoryPageRegionKey,
): PageRegionCapability;
export function pageRegionCapability(
  pageType: PageType,
  key: string,
): PageRegionCapability | undefined {
  return PAGE_REGION_REGISTRY[pageType][key];
}

/** Sanity guard used by tests: every closed region key has exactly one capability entry. */
export function pageRegionKeysFor(pageType: PageType): readonly string[] {
  if (pageType === "product") return PRODUCT_PAGE_REGION_KEYS;
  if (pageType === "category") return CATEGORY_PAGE_REGION_KEYS;
  return [];
}

export function isFixedRequiredRegion(
  pageType: "product" | "category",
  key: string,
): boolean {
  if (pageType === "product") {
    return (FIXED_REQUIRED_PRODUCT_REGION_KEYS as readonly string[]).includes(key);
  }
  return (FIXED_REQUIRED_CATEGORY_REGION_KEYS as readonly string[]).includes(key);
}

/**
 * CUST-H2-3 — swaps a region with its immediate neighbor, refusing to move a
 * FIXED_REQUIRED region at all, and refusing to cross one: `media_gallery`/
 * `identity`/`price`/`quantity_cta` anchor the layout (architecture doc,
 * "Region Reordering" — "required commerce-critical regions may be
 * anchored"), so a swap that would place any region on the far side of one
 * of them is a no-op instead. This naturally creates two independent
 * reorder zones (before `quantity_cta`: `availability`/`variant_selector`;
 * after it: `description`/`custom_fields`/`sku_options_details`) without
 * hardcoding zone boundaries — `variant_selector` is "Limited (position
 * within content column only)" per the architecture doc's own Product Page
 * Region Contract table, which this generic skip-adjacent-fixed rule
 * satisfies exactly: it may swap with `availability` but never cross
 * `price` above it or `quantity_cta` below it.
 */
export function canMoveProductRegion<T extends { key: string }>(
  regions: readonly T[],
  index: number,
  delta: 1 | -1,
): boolean {
  const target = index + delta;
  if (index < 0 || index >= regions.length || target < 0 || target >= regions.length) return false;
  if (isFixedRequiredRegion("product", regions[index].key) || isFixedRequiredRegion("product", regions[target].key)) {
    return false;
  }
  return true;
}

export function moveProductRegion<T extends { key: string }>(
  regions: readonly T[],
  index: number,
  delta: 1 | -1,
): T[] {
  const target = index + delta;
  if (index < 0 || index >= regions.length || target < 0 || target >= regions.length) {
    return regions.slice();
  }
  if (isFixedRequiredRegion("product", regions[index].key) || isFixedRequiredRegion("product", regions[target].key)) {
    return regions.slice();
  }
  const next = regions.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
