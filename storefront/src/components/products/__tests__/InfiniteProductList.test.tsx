import type { Product } from "@spree/sdk";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { InfiniteProductList } from "@/components/products/InfiniteProductList";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "SAR", locale: "ar", loading: false }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: vi.fn(), surface: "dtc" }),
}));

// jsdom has no IntersectionObserver; the component only uses it to trigger
// the next page, which these density-only tests never need to exercise.
class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);

const products = [{ id: "p1", name: "منتج" }] as unknown as Product[];

function renderList(themePreset: "awj-market" | "awj-modern") {
  return render(
    <PublishedThemeMarkerProvider themePreset={themePreset}>
      <InfiniteProductList
        initialProducts={products}
        initialPage={1}
        totalPages={1}
        listParams={{}}
        fetchPage={vi.fn()}
        basePath="/sa/ar"
      />
    </PublishedThemeMarkerProvider>,
  );
}

describe("InfiniteProductList density (catalog/category/search)", () => {
  it("uses the denser AWJ Market column set", () => {
    const { container } = renderList("awj-market");
    expect(container.querySelector(".grid")?.className).toContain(
      "xl:grid-cols-5",
    );
  });

  it("keeps the existing AWJ Modern column set unchanged", () => {
    const { container } = renderList("awj-modern");
    const className = container.querySelector(".grid")?.className;
    expect(className).toContain("xl:grid-cols-4");
    expect(className).not.toContain("xl:grid-cols-5");
  });
});
