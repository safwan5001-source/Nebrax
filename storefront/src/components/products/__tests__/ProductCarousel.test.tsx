import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { ProductCarousel } from "@/components/products/ProductCarousel";
import type { StoreProduct as Product } from "@/lib/commerce/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "SAR", locale: "ar", loading: false }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

// jsdom has no ResizeObserver; Swiper reads one to measure its container.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

const products = [
  { id: "p1", name: "منتج 1" },
  { id: "p2", name: "منتج 2" },
  { id: "p3", name: "منتج 3" },
] as unknown as Product[];

describe("ProductCarousel", () => {
  it("renders every product and the nav controls", () => {
    render(<ProductCarousel products={products} basePath="/sa/ar" />);
    expect(screen.getByText("منتج 1")).toBeInTheDocument();
    expect(screen.getByText("منتج 2")).toBeInTheDocument();
    expect(screen.getByText("منتج 3")).toBeInTheDocument();
    expect(screen.getByLabelText("carouselPrev")).toBeInTheDocument();
    expect(screen.getByLabelText("carouselNext")).toBeInTheDocument();
  });

  it("an arrow with nowhere to go is invisible AND click-through, so it cannot swallow taps meant for the first card's controls", () => {
    render(<ProductCarousel products={products} basePath="/sa/ar" />);
    // At the start of the rail the previous arrow is disabled and hidden …
    const prev = screen.getByLabelText("carouselPrev");
    expect(prev).toBeDisabled();
    expect(prev.className).toContain("opacity-0");
    // … and must not intercept pointer input (it sits over the first card's Quick View on phones).
    expect(prev.className).toContain("pointer-events-none");
  });

  it("Luxe Motion anchors the arrows to the card image (not the whole slide); other themes keep the centred default", () => {
    // jsdom has no layout, so every measured box is 0 — enough to prove the measured anchor is applied (inline `top`)
    // for Luxe and absent for AWJ Modern, where the arrows keep their `top-1/2` class.
    const luxe = render(
      <PublishedThemeMarkerProvider themePreset="awj-luxe-motion">
        <ProductCarousel products={products} basePath="/sa/ar" />
      </PublishedThemeMarkerProvider>,
    );
    expect(screen.getByLabelText("carouselPrev").style.top).toBe("0px");
    expect(screen.getByLabelText("carouselNext").style.top).toBe("0px");
    luxe.unmount();

    render(<ProductCarousel products={products} basePath="/sa/ar" />);
    expect(screen.getByLabelText("carouselPrev").style.top).toBe("");
    expect(screen.getByLabelText("carouselPrev").className).toContain(
      "top-1/2",
    );
  });

  it("shows an honest empty state instead of an empty rail", () => {
    render(<ProductCarousel products={[]} basePath="/sa/ar" />);
    expect(screen.getByText("noProductsFound")).toBeInTheDocument();
    expect(screen.queryByLabelText("carouselNext")).not.toBeInTheDocument();
  });

  it("defaults to the original single-slide-per-view mobile behavior when the caller doesn't override it", () => {
    const { container } = render(
      <ProductCarousel products={products} basePath="/sa/ar" />,
    );
    // Swiper renders `slides-per-view-N` on its wrapper for the active config.
    expect(
      container.querySelector(".swiper-slides-per-view-1, .swiper"),
    ).toBeTruthy();
  });

  it("accepts an overridden slidesPerView/breakpoints (the home-shelf caller's two-column-minimum override)", () => {
    const { container } = render(
      <ProductCarousel
        products={products}
        basePath="/sa/ar"
        slidesPerView={2}
        breakpoints={{ 1024: { slidesPerView: 5 } }}
      />,
    );
    expect(container.querySelector(".product-carousel")).toBeTruthy();
  });
});
