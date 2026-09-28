import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <div data-testid="product-card" data-id={product.id} />
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
  it("widens the desktop tier for AWJ Market without changing AWJ Modern", async () => {
    const fetchProduct = vi.fn().mockResolvedValue({ id: "p1" });

    const marketEl = await loadShelf(fetchProduct, "awj-market");
    const market = render(marketEl as React.JSX.Element);
    expect(market.container.querySelector("ul")?.className).toContain(
      "lg:grid-cols-5",
    );
    market.unmount();

    const modernEl = await loadShelf(fetchProduct);
    const modern = render(modernEl as React.JSX.Element);
    expect(modern.container.querySelector("ul")?.className).toContain(
      "lg:grid-cols-4",
    );
    expect(modern.container.querySelector("ul")?.className).not.toContain(
      "lg:grid-cols-5",
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
