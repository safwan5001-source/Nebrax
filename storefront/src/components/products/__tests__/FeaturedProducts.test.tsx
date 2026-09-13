import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/components/products/ProductCarousel", () => ({
  ProductCarousel: ({ products }: { products: unknown[] }) => (
    <div data-testid="carousel" data-count={products.length} />
  ),
}));

describe("FeaturedProducts (AWJ catalog)", () => {
  it("renders the empty catalog state without requiring Spree configuration when the AWJ API fails", async () => {
    vi.resetModules();
    vi.doMock("next-intl/server", () => ({
      getTranslations: vi.fn(async () => (key: string) => key),
    }));
    vi.doMock("@/lib/data/products", () => ({
      cachedListProducts: vi
        .fn()
        .mockRejectedValue(
          new Error("AWJ storefront API request failed (404)"),
        ),
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

    const { findByText, queryByTestId } = render(element);
    expect(queryByTestId("carousel")).toBeNull();
    expect(await findByText("noProductsFound")).toBeTruthy();
  });

  it("passes through the fetched products on success", async () => {
    vi.resetModules();
    vi.doMock("next-intl/server", () => ({
      getTranslations: vi.fn(async () => (key: string) => key),
    }));
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
