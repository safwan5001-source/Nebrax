import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig } from "../presentation/config";
import { PRESENTATION_CONFIG_VERSION } from "../presentation/tokens";
import {
  CATEGORY_PAGE_REGION_KEYS,
  FIXED_REQUIRED_CATEGORY_REGION_KEYS,
  FIXED_REQUIRED_PRODUCT_REGION_KEYS,
  PAGE_TYPES,
  PRODUCT_PAGE_REGION_KEYS,
  normalizePagePresentation,
} from "../presentation/page-regions";
import {
  PAGE_REGION_REGISTRY,
  pageRegionKeysFor,
} from "../presentation/page-region-registry";

/**
 * CUST-H2-1 — schema/registry foundation. No UI, no public runtime wiring;
 * this only proves the additive `pagePresentation` namespace, the schema
 * bump 2 -> 3, and fail-closed normalization, mirroring
 * `tests/Feature/StorefrontPresentationNormalizerTest.php`'s equivalent
 * cases and `storefront/src/lib/presentation/__tests__/page-presentation.test.ts`.
 */
describe("CUST-H2-1 page presentation schema", () => {
  it("bumps the schema version to 3", () => {
    expect(PRESENTATION_CONFIG_VERSION).toBe(3);
    expect(normalizePresentationConfig({}).version).toBe(3);
  });

  it("is absent by default and every pre-CUST-H2 document stays byte-identical", () => {
    expect(DEFAULT_PRESENTATION_CONFIG.pagePresentation).toBeUndefined();
    expect(normalizePresentationConfig().pagePresentation).toBeUndefined();
    expect(normalizePresentationConfig(undefined)).toEqual(DEFAULT_PRESENTATION_CONFIG);

    const legacyV2 = normalizePresentationConfig({
      version: 2,
      themePreset: "navy",
      homepage: { sections: [{ id: "hero", type: "hero", visible: true }] },
    });
    expect(legacyV2.pagePresentation).toBeUndefined();
    expect(legacyV2.version).toBe(3);
  });

  it("registers exactly home/product/category as page types", () => {
    expect(PAGE_TYPES).toEqual(["home", "product", "category"]);
  });

  it("populates the Page Capability Registry for every closed region key exactly once", () => {
    expect(Object.keys(PAGE_REGION_REGISTRY.product).sort()).toEqual(
      [...PRODUCT_PAGE_REGION_KEYS].sort(),
    );
    expect(Object.keys(PAGE_REGION_REGISTRY.category).sort()).toEqual(
      [...CATEGORY_PAGE_REGION_KEYS].sort(),
    );
    expect(pageRegionKeysFor("product")).toEqual(PRODUCT_PAGE_REGION_KEYS);
    expect(pageRegionKeysFor("category")).toEqual(CATEGORY_PAGE_REGION_KEYS);
  });

  it("every registry entry only allows its own page type and never allows duplication in H2 V1", () => {
    for (const capability of Object.values(PAGE_REGION_REGISTRY.product)) {
      expect(capability.allowedPageTypes).toEqual(["product"]);
      expect(capability.maxInstances).toBe(1);
      expect(capability.canDuplicate).toBe(false);
    }
    for (const capability of Object.values(PAGE_REGION_REGISTRY.category)) {
      expect(capability.allowedPageTypes).toEqual(["category"]);
      expect(capability.maxInstances).toBe(1);
      expect(capability.canDuplicate).toBe(false);
    }
  });

  it("an empty or malformed pagePresentation collapses to absent", () => {
    expect(normalizePagePresentation(undefined)).toBeUndefined();
    expect(normalizePagePresentation(null)).toBeUndefined();
    expect(normalizePagePresentation("nope")).toBeUndefined();
    expect(normalizePagePresentation(["a", "b"])).toBeUndefined();
    expect(normalizePagePresentation({})).toBeUndefined();
    expect(normalizePagePresentation({ product: null, category: "x" })).toBeUndefined();
  });

  it("accepts valid product regions and defaults id to key", () => {
    const result = normalizePagePresentation({
      product: {
        version: 1,
        regions: [
          { key: "description", visible: true },
          { id: "sku-1", key: "sku_options_details", visible: false },
        ],
      },
    });

    expect(result?.category).toBeUndefined();
    const regions = result?.product?.regions ?? [];
    expect(regions.find((r) => r.key === "description")).toMatchObject({
      id: "description",
      visible: true,
    });
    expect(regions.find((r) => r.key === "sku_options_details")).toMatchObject({
      id: "sku-1",
      visible: false,
    });
  });

  it("drops unknown keys and keys that belong to a different page type", () => {
    const result = normalizePagePresentation({
      product: {
        regions: [
          { key: "evil-key", visible: true },
          { key: "breadcrumbs", visible: true }, // a real Category key, invalid on Product
          { key: "description", visible: true },
        ],
      },
    });

    expect(result?.product?.regions.map((r) => r.key)).toEqual(["description"]);
  });

  it("collapses duplicate keys to the first occurrence", () => {
    const result = normalizePagePresentation({
      category: {
        regions: [
          { id: "first", key: "description", visible: true },
          { id: "second", key: "description", visible: false },
        ],
      },
    });

    expect(result?.category?.regions).toHaveLength(1);
    expect(result?.category?.regions[0]).toMatchObject({ id: "first", visible: true });
  });

  it("forces every FIXED_REQUIRED region back to visible regardless of input", () => {
    const result = normalizePagePresentation({
      product: {
        regions: FIXED_REQUIRED_PRODUCT_REGION_KEYS.map((key) => ({ key, visible: false })),
      },
      category: {
        regions: FIXED_REQUIRED_CATEGORY_REGION_KEYS.map((key) => ({ key, visible: false })),
      },
    });

    for (const region of result?.product?.regions ?? []) {
      expect(region.visible).toBe(true);
    }
    for (const region of result?.category?.regions ?? []) {
      expect(region.visible).toBe(true);
    }
  });

  it("does not force variant_selector visible: its FIXED_REQUIRED-ness is product-data-dependent", () => {
    const result = normalizePagePresentation({
      product: { regions: [{ key: "variant_selector", visible: false }] },
    });

    expect(result?.product?.regions[0]).toMatchObject({ visible: false });
  });

  it("always drops region content in this slice", () => {
    const result = normalizePagePresentation({
      product: {
        regions: [{ key: "description", visible: true, content: { text: "hello" } }],
      },
    });

    expect(result?.product?.regions[0]).not.toHaveProperty("content");
  });

  it("a forward page-content schema version drops only that page type", () => {
    const result = normalizePagePresentation({
      product: { version: 99, regions: [{ key: "description", visible: true }] },
      category: { version: 1, regions: [{ key: "description", visible: true }] },
    });

    expect(result?.product).toBeUndefined();
    expect(result?.category).toBeDefined();
  });

  it("round-trips stably across repeated normalization", () => {
    const input = {
      product: {
        regions: [
          { key: "media_gallery", visible: false },
          { key: "description", visible: true },
        ],
      },
    };

    const once = normalizePagePresentation(input);
    const twice = normalizePagePresentation(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("round-trips through the full document normalizer stably", () => {
    const once = normalizePresentationConfig({
      pagePresentation: {
        product: { regions: [{ key: "media_gallery", visible: false }] },
      },
    });
    const twice = normalizePresentationConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.pagePresentation).toEqual(once.pagePresentation);
  });
});
