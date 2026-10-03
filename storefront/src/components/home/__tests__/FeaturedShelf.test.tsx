import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

async function loadShelf(
  fetchProductsByIds: ReturnType<typeof vi.fn>,
  productIds: string[] = ["p1"],
  themePreset?: "awj-market",
) {
  vi.resetModules();
  vi.doMock("@/components/products/ProductCard", () => ({
    ProductCard: ({ product }: { product: { id: string } }) => (
      <div data-testid="product-card" data-id={product.id} />
    ),
  }));
  vi.doMock("@/components/products/ProductCarousel", () => ({
    ProductCarousel: (props: {
      products: { id: string }[];
      slidesPerView?: number;
      listId?: string;
      listName?: string;
    }) => (
      <div
        data-testid="product-carousel"
        data-count={props.products.length}
        data-ids={props.products.map((p) => p.id).join(",")}
        data-slides-per-view={props.slidesPerView}
        data-list-id={props.listId}
        data-list-name={props.listName}
      />
    ),
  }));
  vi.doMock("@/lib/commerce/products", () => ({ fetchProductsByIds }));

  const { FeaturedShelf } = await import("@/components/home/FeaturedShelf");
  return FeaturedShelf({
    productIds,
    basePath: "/sa/ar",
    locale: "ar",
    title: "مميز",
    headingId: "featured-1",
    themePreset,
  });
}

describe("FeaturedShelf — CUST-H4-5 batched read", () => {
  it("renders as a carousel for AWJ Market, starting from two slides on mobile (never one)", async () => {
    const fetchProductsByIds = vi.fn().mockResolvedValue([{ id: "p1" }]);

    const marketEl = await loadShelf(fetchProductsByIds, ["p1"], "awj-market");
    const market = render(marketEl as React.JSX.Element);
    const carousel = market.getByTestId("product-carousel");
    expect(carousel.dataset.slidesPerView).toBe("2");
    expect(carousel.dataset.listId).toBe("home_featured");
  });

  it("keeps AWJ Modern as a static grid — no theme regression", async () => {
    const fetchProductsByIds = vi.fn().mockResolvedValue([{ id: "p1" }]);

    const modernEl = await loadShelf(fetchProductsByIds);
    const modern = render(modernEl as React.JSX.Element);
    expect(modern.queryByTestId("product-carousel")).toBeNull();
    expect(modern.container.querySelector("ul")?.className).toContain(
      "lg:grid-cols-4",
    );
  });

  it("renders nothing when the batched read fails entirely", async () => {
    const element = await loadShelf(
      vi.fn().mockRejectedValue(new Error("network down")),
      ["p1"],
      "awj-market",
    );
    expect(element).toBeNull();
  });

  it("renders nothing when every selected id is missing from the result", async () => {
    const element = await loadShelf(
      vi.fn().mockResolvedValue([]),
      ["p1", "p2"],
      "awj-market",
    );
    expect(element).toBeNull();
  });

  it("calls the batched read exactly once regardless of how many ids are selected (no N+1)", async () => {
    const fetchProductsByIds = vi
      .fn()
      .mockResolvedValue([{ id: "p1" }, { id: "p2" }, { id: "p3" }]);

    await loadShelf(fetchProductsByIds, ["p1", "p2", "p3"], "awj-market");
    expect(fetchProductsByIds).toHaveBeenCalledTimes(1);
    expect(fetchProductsByIds).toHaveBeenCalledWith(["p1", "p2", "p3"]);
  });

  it("re-orders a differently-ordered API response back into the stored productIds order", async () => {
    // The API answers in a different order (e.g. database id order) than
    // the merchant curated — the stored array stays the display authority.
    const fetchProductsByIds = vi
      .fn()
      .mockResolvedValue([{ id: "p3" }, { id: "p1" }, { id: "p2" }]);

    const element = await loadShelf(
      fetchProductsByIds,
      ["p1", "p2", "p3"],
      "awj-market",
    );
    const rendered = render(element as React.JSX.Element);
    const carousel = rendered.getByTestId("product-carousel");
    expect(carousel.dataset.ids).toBe("p1,p2,p3");
  });

  it("omits a selected id that is missing from the result without shifting the rest", async () => {
    // p2 failed to resolve (foreign/unpublished/deleted) — p1 and p3 still
    // render, in their stored order, with no placeholder for p2.
    const fetchProductsByIds = vi
      .fn()
      .mockResolvedValue([{ id: "p1" }, { id: "p3" }]);

    const element = await loadShelf(
      fetchProductsByIds,
      ["p1", "p2", "p3"],
      "awj-market",
    );
    const rendered = render(element as React.JSX.Element);
    const carousel = rendered.getByTestId("product-carousel");
    expect(carousel.dataset.ids).toBe("p1,p3");
    expect(carousel.dataset.count).toBe("2");
  });
});
