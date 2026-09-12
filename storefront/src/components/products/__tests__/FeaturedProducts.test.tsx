import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/spree", () => ({
  getAccessToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/products/ProductCarousel", () => ({
  ProductCarousel: ({ products }: { products: unknown[] }) => (
    <div data-testid="carousel" data-count={products.length} />
  ),
}));

describe("FeaturedProducts (COM-7-PREVIEW-FIX-1)", () => {
  it("degrades to an empty carousel instead of crashing the homepage when the AWJ catalog API fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data/products", () => ({
      cachedListProducts: vi
        .fn()
        .mockRejectedValue(new Error("AWJ storefront API request failed (404)")),
    }));

    const { FeaturedProducts } = await import(
      "@/components/products/FeaturedProducts"
    );

    const element = await FeaturedProducts({
      basePath: "/sa/ar",
      locale: "ar",
      country: "sa",
      currency: "SAR",
    });

    const { findByTestId } = render(element);
    const carousel = await findByTestId("carousel");
    expect(carousel.getAttribute("data-count")).toBe("0");
  });

  it("passes through the fetched products on success", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data/products", () => ({
      cachedListProducts: vi.fn().mockResolvedValue({
        data: [{ id: "p1" }, { id: "p2" }],
      }),
    }));

    const { FeaturedProducts } = await import(
      "@/components/products/FeaturedProducts"
    );

    const element = await FeaturedProducts({
      basePath: "/sa/ar",
      locale: "ar",
      country: "sa",
      currency: "SAR",
    });

    const { findByTestId } = render(element);
    await waitFor(async () => {
      const carousel = await findByTestId("carousel");
      expect(carousel.getAttribute("data-count")).toBe("2");
    });
  });
});
