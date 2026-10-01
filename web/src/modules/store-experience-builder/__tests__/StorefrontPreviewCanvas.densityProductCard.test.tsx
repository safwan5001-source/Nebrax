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
