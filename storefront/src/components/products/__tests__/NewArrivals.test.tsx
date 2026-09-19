import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <div data-testid="product-card" data-id={product.id} />
  ),
}));

async function loadNewArrivals(
  listProducts: ReturnType<typeof vi.fn>,
): Promise<{ element: React.JSX.Element; listProducts: typeof listProducts }> {
  vi.resetModules();
  vi.doMock("next-intl/server", () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
  }));
  vi.doMock("@/components/products/ProductCard", () => ({
    ProductCard: ({ product }: { product: { id: string } }) => (
      <div data-testid="product-card" data-id={product.id} />
    ),
  }));
  vi.doMock("@/lib/data/products", () => ({
    cachedListProducts: listProducts,
  }));

  const { NewArrivals } = await import("@/components/products/NewArrivals");
  const element = await NewArrivals({
    basePath: "/sa/ar",
    locale: "ar",
    country: "sa",
    currency: "SAR",
  });

  return { element, listProducts };
}

describe("NewArrivals (AWJ catalog)", () => {
  it("orders the shelf by the catalogue's own creation date", async () => {
    const listProducts = vi.fn().mockResolvedValue({ data: [] });
    await loadNewArrivals(listProducts);

    // AWJ exposes no featuring or sales-volume signal, so the only honest
    // basis for this shelf is the one ordering the catalogue supports.
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "-available_on" }),
      expect.anything(),
      "dtc",
    );
  });

  it("renders the empty catalog state when the AWJ API fails", async () => {
    const { element } = await loadNewArrivals(
      vi
        .fn()
        .mockRejectedValue(
          new Error("AWJ storefront API request failed (404)"),
        ),
    );

    const { findByText, queryAllByTestId } = render(element);
    expect(queryAllByTestId("product-card")).toHaveLength(0);
    expect(await findByText("noProductsFound")).toBeTruthy();
  });

  it("renders a card per product on success", async () => {
    const { element } = await loadNewArrivals(
      vi.fn().mockResolvedValue({ data: [{ id: "p1" }, { id: "p2" }] }),
    );

    const { getAllByTestId } = render(element);
    expect(getAllByTestId("product-card")).toHaveLength(2);
  });

  it("stays intentional with a single product rather than stretching it", async () => {
    const { element } = await loadNewArrivals(
      vi.fn().mockResolvedValue({ data: [{ id: "only" }] }),
    );

    const { container, getAllByTestId } = render(element);
    expect(getAllByTestId("product-card")).toHaveLength(1);
    // A grid, not a flex row: one product keeps a card's width instead of
    // expanding to the full measure.
    expect(container.querySelector("ul")?.className).toContain("grid-cols-2");
  });
});
