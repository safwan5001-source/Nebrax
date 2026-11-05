/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { CategoryPageRegionKey, PageRegionInstance } from "../presentation/page-regions";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

/**
 * CUST-H3-3 — closes two Canvas/Published parity gaps found in the evidence
 * pass:
 *
 * 1. `density` already drove the Home preview's section rhythm (parity with
 *    `publishedHomeStackClass`), but the Product/Category page previews'
 *    own outer padding never had a Published counterpart to match — the
 *    Canvas showed a real compact/comfortable difference the public
 *    storefront never rendered. `pageContainerPaddingClass()` now backs
 *    both this Canvas preview and the real Product/Category page shells
 *    (see `ProductDetails.test.tsx` and `public-rhythm.test.ts` for the
 *    Published side of this same parity).
 * 2. `productCard` already drove the Home "new arrivals" shelf mock's card
 *    padding, but the Category page preview's `product_grid` region used a
 *    completely separate, hard-coded mock card that ignored `productCard`
 *    entirely — a merchant switching to "compact" would see no difference
 *    on the one page where the real published grid (`ProductCard.tsx` via
 *    `InfiniteProductList`) already changes the most.
 */

const category = {
  id: "cat-1",
  name: "Shoes",
  description: null,
  parentId: null,
  children: [],
  ancestors: [],
};

const categoryRegions: PageRegionInstance<CategoryPageRegionKey>[] = [
  { id: "product_grid", key: "product_grid", visible: true },
];

const gridProducts = [
  { id: "p-1", name: "Running Shoe", thumbnailUrl: null },
  { id: "p-2", name: "Walking Shoe", thumbnailUrl: null },
];

/** Class tokens of an element (the web suite has no jest-dom matchers). */
function classesOf(el: Element | null | undefined): string[] {
  return Array.from(el?.classList ?? []);
}

describe("web customizer preview — CUST-H3-3 density on Product/Category page shells", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the comfortable page-shell padding by default on the Product preview", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
        page="product"
        productPreviewState="empty"
      />,
    );
    const shell = container.querySelector('[data-product-preview-state="empty"]');
    expect(shell?.className).toContain("py-14");
    expect(shell?.className).toContain("md:py-20");
  });

  it("shrinks the Product preview's page-shell padding for a compact density", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, density: "compact" as const };
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
        page="product"
        productPreviewState="empty"
      />,
    );
    const shell = container.querySelector('[data-product-preview-state="empty"]');
    expect(shell?.className).toContain("py-10");
    expect(shell?.className).not.toContain("py-14");
  });

  it("shrinks the Category preview's page-shell padding for a compact density", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, density: "compact" as const };
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    const shell = container.querySelector('[data-category-preview="ready"]');
    expect(shell?.className).toContain("py-3");
    expect(shell?.className).not.toContain("py-5");
  });

  it("keeps the comfortable Category preview padding when density is comfortable", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    const shell = container.querySelector('[data-category-preview="ready"]');
    expect(shell?.className).toContain("py-5");
    expect(shell?.className).toContain("md:py-6");
  });
});

describe("web customizer preview — CUST-H3-3 productCard on the Category page grid", () => {
  afterEach(() => {
    cleanup();
  });

  function gridTileText(container: HTMLElement, name: string): Element {
    const node = Array.from(container.querySelectorAll("p")).find(
      (p) => p.textContent === name,
    );
    if (!node) throw new Error(`grid tile for "${name}" not found`);
    return node;
  }

  it("uses the standard tile padding by default, matching the published standard ProductCard", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    const tile = gridTileText(container, "Running Shoe");
    expect(tile.className).toContain("px-2");
    expect(tile.className).toContain("py-1.5");
  });

  it("shows a real, smaller tile padding when productCard is compact", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, productCard: "compact" as const };
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    const tile = gridTileText(container, "Running Shoe");
    expect(tile.className).toContain("px-1.5");
    expect(tile.className).toContain("py-1");
    expect(tile.className).not.toContain("px-2");
  });
});


describe("AWJ Luxe Motion — Product Customizer preview parity", () => {
  afterEach(() => cleanup());

  const previewProduct = {
    id: "luxe-1",
    name: "Luxury Gift Box",
    nameEn: "Luxury Gift Box",
    description: "Real merchant-authored copy",
    sku: "GIFT-1",
    categoryName: "Gifts",
    priceAmountMinor: 12500,
    currency: "SAR",
    inStock: true,
    media: [],
    isVariantManaged: false,
    options: null,
    variants: null,
  };
  const productRegions = [
    { id: "media_gallery", key: "media_gallery", visible: true },
    { id: "identity", key: "identity", visible: true },
    { id: "price", key: "price", visible: true },
    { id: "quantity_cta", key: "quantity_cta", visible: true },
  ] as const;

  it("shows Luxe-only gallery, title, price and purchase geometry in the real product preview", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={{ ...DEFAULT_PRESENTATION_CONFIG, themePreset: "awj-luxe-motion" }}
        locale="en"
        viewport="mobile"
        page="product"
        productPreviewState="ready"
        previewProduct={previewProduct}
        productRegions={[...productRegions]}
      />,
    );
    const shell = container.querySelector('[data-product-preview="ready"]');
    expect(shell?.hasAttribute("data-luxe-motion")).toBe(true);
    expect(classesOf(shell?.querySelector("h1"))).toContain("text-2xl");
    expect(shell?.querySelector(".border-store-border.bg-store-surface-muted")).not.toBeNull();
    expect(shell?.querySelector(".h-12")).not.toBeNull();
    expect(container.textContent).toContain("Luxury Gift Box");
  });

  it("leaves the standard preview layout unchanged for AWJ Modern", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="mobile"
        page="product"
        productPreviewState="ready"
        previewProduct={previewProduct}
        productRegions={[...productRegions]}
      />,
    );
    const shell = container.querySelector('[data-product-preview="ready"]');
    expect(shell?.hasAttribute("data-luxe-motion")).toBe(false);
    expect(classesOf(shell?.querySelector("h1"))).toContain("text-lg");
    expect(classesOf(shell?.querySelector("h1"))).not.toContain("text-2xl");
  });
});


describe("AWJ Luxe Motion — Category product-card preview parity", () => {
  afterEach(() => cleanup());

  const luxeConfig = { ...DEFAULT_PRESENTATION_CONFIG, themePreset: "awj-luxe-motion" as const };

  it("uses the portrait image ratio and comfortable two-line card body only for Luxe Motion", () => {
    const { container, rerender } = render(
      <StorefrontPreviewCanvas
        config={luxeConfig}
        locale="ar"
        viewport="mobile"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    let shell = container.querySelector('[data-category-preview="ready"]');
    expect(shell?.hasAttribute("data-luxe-motion")).toBe(true);
    const card = shell?.querySelector('[data-card]');
    expect(classesOf(card)).toContain("border-store-border");
    expect(classesOf(card?.querySelector('[data-card-image]'))).toContain("aspect-[3/4]");
    expect(classesOf(card?.querySelector("p"))).toContain("line-clamp-2");
    expect(classesOf(card?.querySelector("p"))).toContain("text-sm");
    expect(classesOf(card?.querySelector("p"))).toContain("px-3.5");

    rerender(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="ar"
        viewport="mobile"
        page="category"
        categoryPreviewState="ready"
        previewCategory={category}
        categoryRegions={categoryRegions}
        categoryGridProductsState="ready"
        categoryGridProducts={gridProducts}
        categoryGridProductsTotal={gridProducts.length}
      />,
    );
    shell = container.querySelector('[data-category-preview="ready"]');
    expect(shell?.hasAttribute("data-luxe-motion")).toBe(false);
    expect(classesOf(shell?.querySelector('[data-card-image]'))).toContain("aspect-square");
    expect(classesOf(shell?.querySelector('[data-card-image]'))).not.toContain("aspect-[3/4]");
  });
});
