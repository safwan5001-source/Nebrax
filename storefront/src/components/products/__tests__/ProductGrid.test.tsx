import type { Product } from "@spree/sdk";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { ProductGrid } from "@/components/products/ProductGrid";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "SAR", locale: "ar", loading: false }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: vi.fn(), surface: "dtc" }),
}));

const products = [{ id: "p1", name: "منتج" }] as unknown as Product[];

describe("ProductGrid density", () => {
  it("uses the denser AWJ Market column set", () => {
    const { container } = render(
      <PublishedThemeMarkerProvider themePreset="awj-market">
        <ProductGrid products={products} />
      </PublishedThemeMarkerProvider>,
    );
    expect(container.querySelector(".grid")?.className).toContain(
      "xl:grid-cols-5",
    );
  });

  it("keeps the existing AWJ Modern column set unchanged", () => {
    const { container } = render(
      <PublishedThemeMarkerProvider themePreset="awj-modern">
        <ProductGrid products={products} />
      </PublishedThemeMarkerProvider>,
    );
    const className = container.querySelector(".grid")?.className;
    expect(className).toContain("xl:grid-cols-4");
    expect(className).not.toContain("xl:grid-cols-5");
  });
});
