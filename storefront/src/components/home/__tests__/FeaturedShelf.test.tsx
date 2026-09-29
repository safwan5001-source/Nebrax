import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <div data-testid="product-card" data-id={product.id} />
  ),
}));

vi.mock("@/components/products/ProductCarousel", () => ({
  ProductCarousel: (props: {
    products: { id: string }[];
    slidesPerView?: number;
    listId?: string;
    listName?: string;
  }) => (
    <div
      data-testid="product-carousel"
      data-count={props.products.length}
      data-slides-per-view={props.slidesPerView}
      data-list-id={props.listId}
      data-list-name={props.listName}
    />
  ),
}));

async function loadShelf(
  fetchProduct: ReturnType<typeof vi.fn>,
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
        data-slides-per-view={props.slidesPerView}
        data-list-id={props.listId}
        data-list-name={props.listName}
      />
    ),
  }));
  vi.doMock("@/lib/commerce/products", () => ({ fetchProduct }));

  const { FeaturedShelf } = await import("@/components/home/FeaturedShelf");
  return FeaturedShelf({
    productIds: ["p1"],
    basePath: "/sa/ar",
    locale: "ar",
    title: "مميز",
    headingId: "featured-1",
    themePreset,
  });
}

describe("FeaturedShelf density", () => {
  it("renders as a carousel for AWJ Market, starting from two slides on mobile (never one)", async () => {
    const fetchProduct = vi.fn().mockResolvedValue({ id: "p1" });

    const marketEl = await loadShelf(fetchProduct, "awj-market");
    const market = render(marketEl as React.JSX.Element);
    const carousel = market.getByTestId("product-carousel");
    expect(carousel.dataset.slidesPerView).toBe("2");
    expect(carousel.dataset.listId).toBe("home_featured");
  });

  it("keeps AWJ Modern as a static grid — no theme regression", async () => {
    const fetchProduct = vi.fn().mockResolvedValue({ id: "p1" });

    const modernEl = await loadShelf(fetchProduct);
    const modern = render(modernEl as React.JSX.Element);
    expect(modern.queryByTestId("product-carousel")).toBeNull();
    expect(modern.container.querySelector("ul")?.className).toContain(
      "lg:grid-cols-4",
    );
  });

  it("renders nothing when every product id fails to resolve, regardless of theme", async () => {
    const element = await loadShelf(
      vi.fn().mockRejectedValue(new Error("not found")),
      "awj-market",
    );
    expect(element).toBeNull();
  });
});
