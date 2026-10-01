import { describe, expect, it } from "vitest";
import {
  CATEGORY_PAGE_REGION_KEYS,
  type PagePresentation,
  PRODUCT_PAGE_REGION_KEYS,
} from "../page-regions";
import {
  resolvePublicCategoryRegions,
  resolvePublicProductRegions,
} from "../page-runtime";

/**
 * CUST-H2-5 — public runtime resolution of `pagePresentation.{product,category}`.
 * These are pure-function tests of the fail-safe merge itself; component-level
 * parity (real DOM order, data-absence honesty) is covered by
 * `ProductDetails.test.tsx` and `CategoryBanner.test.tsx`.
 */
describe("resolvePublicProductRegions", () => {
  it("falls back to the canonical default order when pagePresentation is absent", () => {
    expect(resolvePublicProductRegions(undefined, false)).toEqual([
      "media_gallery",
      "identity",
      "price",
      "availability",
      "quantity_cta",
      "description",
      "custom_fields",
      "sku_options_details",
    ]);
  });

  it("omits variant_selector by default when the product has no variants", () => {
    const order = resolvePublicProductRegions(undefined, false);
    expect(order).not.toContain("variant_selector");
  });

  it("includes variant_selector in its canonical position when the product has variants", () => {
    const order = resolvePublicProductRegions(undefined, true);
    expect(order).toEqual(PRODUCT_PAGE_REGION_KEYS);
  });

  it("respects an authored order and hidden optional regions", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
          { id: "availability", key: "availability", visible: false },
          { id: "variant_selector", key: "variant_selector", visible: true },
          { id: "quantity_cta", key: "quantity_cta", visible: true },
          // Authored order: sku_options_details before description.
          {
            id: "sku_options_details",
            key: "sku_options_details",
            visible: true,
          },
          { id: "description", key: "description", visible: true },
          { id: "custom_fields", key: "custom_fields", visible: false },
        ],
      },
    };

    expect(resolvePublicProductRegions(pagePresentation, false)).toEqual([
      "media_gallery",
      "identity",
      "price",
      "quantity_cta",
      "sku_options_details",
      "description",
    ]);
  });

  it("never hides variant_selector when the product has variants, even if the stored entry says visible: false", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          // A shape the Customizer never actually produces (no UI offers
          // hiding this region) — the public renderer must not trust it.
          { id: "variant_selector", key: "variant_selector", visible: false },
        ],
      },
    };

    const order = resolvePublicProductRegions(pagePresentation, true);
    expect(order).toContain("variant_selector");
    // FIXED_REQUIRED regions are still guaranteed present too.
    expect(order).toEqual(
      expect.arrayContaining([
        "media_gallery",
        "identity",
        "price",
        "quantity_cta",
      ]),
    );
  });

  it("omits variant_selector even if it is stored visible: true, when the product actually has no variants", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "variant_selector", key: "variant_selector", visible: true },
        ],
      },
    };

    expect(resolvePublicProductRegions(pagePresentation, false)).not.toContain(
      "variant_selector",
    );
  });

  it("fails safe to the canonical order when a commerce-critical region is missing from a malformed stored array", () => {
    const pagePresentation: PagePresentation = {
      product: {
        version: 1,
        // `quantity_cta` (Add-to-Cart) missing outright — a shape the
        // Customizer never produces, but the public renderer must never
        // trust that blindly.
        regions: [
          { id: "media_gallery", key: "media_gallery", visible: true },
          { id: "identity", key: "identity", visible: true },
          { id: "price", key: "price", visible: true },
        ],
      },
    };

    expect(resolvePublicProductRegions(pagePresentation, false)).toContain(
      "quantity_cta",
    );
  });

  it("drops unknown/forward-schema region keys defensively", () => {
    const pagePresentation = {
      product: {
        version: 1,
        regions: [
          { id: "x", key: "not_a_real_region", visible: true },
          { id: "identity", key: "identity", visible: true },
        ],
      },
    } as any as PagePresentation;

    const order = resolvePublicProductRegions(pagePresentation, false);
    expect(order).not.toContain("not_a_real_region");
    expect(order).toContain("identity");
  });
});

describe("resolvePublicCategoryRegions", () => {
  it("falls back to the canonical default order when pagePresentation is absent", () => {
    expect(resolvePublicCategoryRegions(undefined)).toEqual(
      CATEGORY_PAGE_REGION_KEYS,
    );
  });

  it("respects a hidden description and an authored subcategories_rail position", () => {
    const pagePresentation: PagePresentation = {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          // subcategories_rail authored ahead of description (the one legal
          // Category reorder — see the H2-4 report's own reorder rule).
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: true,
          },
          { id: "description", key: "description", visible: false },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };

    expect(resolvePublicCategoryRegions(pagePresentation)).toEqual([
      "breadcrumbs",
      "identity_title",
      "subcategories_rail",
      "filter_sort_bar",
      "product_grid",
    ]);
  });

  it("always keeps breadcrumbs/identity_title/filter_sort_bar/product_grid present, even from a malformed stored array", () => {
    const pagePresentation: PagePresentation = {
      category: {
        version: 1,
        regions: [{ id: "description", key: "description", visible: true }],
      },
    };

    const order = resolvePublicCategoryRegions(pagePresentation);
    expect(order).toEqual(
      expect.arrayContaining([
        "breadcrumbs",
        "identity_title",
        "filter_sort_bar",
        "product_grid",
      ]),
    );
  });
});
