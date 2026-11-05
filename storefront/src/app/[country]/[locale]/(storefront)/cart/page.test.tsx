import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderingProvider } from "@/contexts/OrderingContext";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import en from "../../../../../../messages/en.json";

const cartState = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("next/navigation", () => ({ usePathname: () => "/us/en/cart" }));
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    cart: cartState.value,
    loading: false,
    updating: false,
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    accessIssue: null,
  }),
}));
vi.mock("@/hooks/useCartLineImages", () => ({ useCartLineImages: () => ({}) }));
vi.mock("@/components/cart/CartLine", () => ({
  awjCartLineView: () => ({}),
  CartLine: () => <div data-testid="cart-line" />,
}));

import CartPage from "./page";

const cart = (subtotalMinor: number) => ({
  kind: "awj" as const,
  items: [
    {
      id: "line-1",
      productId: "p1",
      variantId: null,
      variantDescriptor: null,
      name: "Item",
      unitKey: "base",
      unitName: "pc",
      quantity: 1,
      unitPrice: { amount_minor: subtotalMinor, currency: "SAR" },
      lineTotal: { amount_minor: subtotalMinor, currency: "SAR" },
      available: true,
      personalization: [],
      addonOf: null,
      perParentQuantity: null,
    },
  ],
  subtotal: { amount_minor: subtotalMinor, currency: "SAR" },
  currency: "SAR",
  hasUnavailableItems: false,
  itemCount: 1,
});

const ordering = (over: Partial<AwjOrdering> = {}): AwjOrdering => ({
  accepting: true,
  reason: null,
  message: null,
  resumesAt: null,
  minOrderMinor: null,
  minOrderScope: "all",
  ...over,
});

function mount(block: AwjOrdering | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OrderingProvider ordering={block}>
        <CartPage />
      </OrderingProvider>
    </NextIntlClientProvider>,
  );
}

const checkoutLink = () =>
  screen.getByRole("link", { name: /Proceed to checkout|checkout/i });

describe("Cart page ordering notice (COPS-H4 Buyer Ordering UX)", () => {
  beforeEach(() => {
    cartState.value = cart(12000);
  });

  it("is unchanged while the gate is closed: no notice, the checkout action is there", () => {
    mount(null);
    expect(document.querySelector("[data-ordering-cart-notice]")).toBeNull();
    expect(checkoutLink()).toHaveAttribute("href", "/us/en/checkout");
  });

  it("shows the minimum and the exact shortfall above the checkout action", () => {
    mount(ordering({ minOrderMinor: 15000 }));
    const notice = document.querySelector("[data-ordering-cart-notice]");
    expect(notice).not.toBeNull();
    expect(screen.getByText(/Add at least/)).toHaveAttribute(
      "data-ordering-shortfall",
      "3000",
    );
    // The notice precedes the action in document order.
    if (!notice) throw new Error("notice missing");
    expect(
      notice.compareDocumentPosition(checkoutLink()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // The server's Checkout is the only authority: even below the minimum or while paused, the shopper is never blocked here.
  it("never disables or removes the checkout action — below the minimum", () => {
    mount(ordering({ minOrderMinor: 15000 }));
    expect(checkoutLink()).toHaveAttribute("href", "/us/en/checkout");
    expect(checkoutLink()).not.toHaveAttribute("aria-disabled");
  });

  it("never disables or removes the checkout action — while the store is not accepting orders", () => {
    mount(ordering({ accepting: false, reason: "paused" }));
    expect(
      screen.getByText(
        /not taking new orders right now\. You can keep your items/,
      ),
    ).toBeInTheDocument();
    expect(checkoutLink()).toHaveAttribute("href", "/us/en/checkout");
    expect(checkoutLink()).not.toHaveAttribute("aria-disabled");
  });

  it("shows 'reached' once the cart meets the minimum", () => {
    cartState.value = cart(20000);
    mount(ordering({ minOrderMinor: 15000 }));
    expect(
      screen.getByText("Your order has reached the minimum."),
    ).toBeInTheDocument();
  });
});
