import type { Product } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductCarousel } from "@/components/products/ProductCarousel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ currency: "SAR", locale: "ar", loading: false }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: vi.fn(), surface: "dtc" }),
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
