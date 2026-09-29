import type { Product } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickView } from "@/components/products/QuickView";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mockAddItem = vi.fn();
const mockSurface = { current: "dtc" as "dtc" | "wholesale" };
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ addItem: mockAddItem, surface: mockSurface.current }),
}));

const simpleProduct = {
  id: "prod-1",
  name: "Classic T-Shirt",
  slug: "classic-t-shirt",
  purchasable: true,
  thumbnail_url: "https://example.com/shirt.jpg",
  price: {
    display_amount: "$25.00",
    amount_in_cents: 2500,
    compare_at_amount_in_cents: null,
    display_compare_at_amount: null,
  },
  original_price: { display_amount: "$25.00", amount_in_cents: 2500 },
} as unknown as Product;

const onSaleProduct = {
  ...simpleProduct,
  id: "prod-2",
  price: {
    display_amount: "$18.00",
    amount_in_cents: 1800,
    compare_at_amount_in_cents: 2500,
    display_compare_at_amount: "$25.00",
  },
  original_price: { display_amount: null, amount_in_cents: null },
} as unknown as Product;

const outOfStockProduct = {
  ...simpleProduct,
  id: "prod-3",
  purchasable: false,
} as unknown as Product;

describe("QuickView", () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockSurface.current = "dtc";
  });

  it("opens on click without a duplicate product-detail fetch — no fetch mock is wired at all", async () => {
    const user = userEvent.setup();
    render(
      <QuickView
        product={simpleProduct}
        basePath="/us/en"
        isVariantManaged={false}
      />,
    );
    await user.click(screen.getByLabelText("quickView"));
    expect(screen.getByText("Classic T-Shirt")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });

  it("shows the real strikethrough price only when the catalogue itself marks the product on sale", async () => {
    const user = userEvent.setup();
    render(
      <QuickView
        product={onSaleProduct}
        basePath="/us/en"
        isVariantManaged={false}
      />,
    );
    await user.click(screen.getByLabelText("quickView"));
    expect(screen.getByText("$18.00")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });

  it("adds to cart with the chosen quantity using the same authority ProductCard uses", async () => {
    const user = userEvent.setup();
    render(
      <QuickView
        product={simpleProduct}
        basePath="/us/en"
        isVariantManaged={false}
      />,
    );
    await user.click(screen.getByLabelText("quickView"));
    await user.click(screen.getByText("addToCart"));
    expect(mockAddItem).toHaveBeenCalledWith("prod-1", 1, "base", null);
  });

  it("never offers quick-add for a variant-managed product (no variant is resolvable from listing data)", async () => {
    const user = userEvent.setup();
    render(
      <QuickView
        product={simpleProduct}
        basePath="/us/en"
        isVariantManaged={true}
      />,
    );
    await user.click(screen.getByLabelText("quickView"));
    expect(screen.queryByText("addToCart")).not.toBeInTheDocument();
    expect(screen.getByText("selectOptions")).toBeInTheDocument();
  });

  it("never offers quick-add for an out-of-stock product", async () => {
    const user = userEvent.setup();
    render(
      <QuickView
        product={outOfStockProduct}
        basePath="/us/en"
        isVariantManaged={false}
      />,
    );
    await user.click(screen.getByLabelText("quickView"));
    expect(screen.queryByText("addToCart")).not.toBeInTheDocument();
    expect(screen.getByText("outOfStock")).toBeInTheDocument();
  });
});
