import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CartDrawer } from "../CartDrawer";

vi.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/us/ar/products",
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@/lib/analytics/gtm", () => ({
  trackRemoveFromCart: vi.fn(),
  trackViewCart: vi.fn(),
}));

const mockUpdateItem = vi.fn();
const mockRemoveItem = vi.fn();

const awjCartWithUnavailableLine = {
  kind: "awj" as const,
  items: [
    {
      id: "line-1",
      productId: "prod-1",
      name: "Deleted product",
      unitKey: "base",
      unitName: "piece",
      quantity: 2,
      unitPrice: { amount_minor: 0, currency: "SAR" },
      lineTotal: { amount_minor: 0, currency: "SAR" },
      available: false,
    },
  ],
  subtotal: { amount_minor: 0, currency: "SAR" },
  currency: "SAR",
  hasUnavailableItems: true,
  itemCount: 2,
};

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    cart: awjCartWithUnavailableLine,
    loading: false,
    updating: false,
    isOpen: true,
    closeCart: vi.fn(),
    updateItem: mockUpdateItem,
    removeItem: mockRemoveItem,
    itemCount: 2,
    refreshCart: vi.fn(),
  }),
}));

describe("CartDrawer — AWJ unavailable line", () => {
  beforeEach(() => {
    mockUpdateItem.mockClear();
    mockRemoveItem.mockClear();
  });

  it("keeps an unavailable line visible with its unavailable notice", () => {
    render(<CartDrawer />);

    expect(screen.getByText("Deleted product")).toBeInTheDocument();
    expect(screen.getByText("itemUnavailable")).toBeInTheDocument();
  });

  it("disables the quantity control for an unavailable line", () => {
    render(<CartDrawer />);

    const quantityInput = screen.getByLabelText("quantity");
    expect(quantityInput).toBeDisabled();
  });

  it("keeps the remove button enabled for an unavailable line", async () => {
    render(<CartDrawer />);

    const removeButton = screen.getByRole("button", {
      name: /removeItemLabel/,
    });
    expect(removeButton).toBeEnabled();

    removeButton.click();
    expect(mockRemoveItem).toHaveBeenCalledWith("line-1");
  });
});
