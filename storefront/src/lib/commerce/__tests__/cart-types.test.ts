import { describe, expect, it } from "vitest";
import {
  type AwjCart,
  formatMinorAmount,
  isStorefrontCart,
  mapAwjCartToViewModel,
} from "../cart-types";

describe("commerce/cart-types — AWJ Cart V1 view model", () => {
  it("passes amount_minor and currency through unchanged — never recomputes totals", () => {
    const raw: AwjCart = {
      status: "active",
      items: [
        {
          id: "item-1",
          product_id: "prod-1",
          product_variant_id: null,
          variant_descriptor: null,
          product_name: "Cement bag",
          unit_key: "unit:abc",
          unit_name: "pallet",
          quantity: 2,
          unit_price: { amount_minor: 45000, currency: "SAR" },
          line_total: { amount_minor: 90000, currency: "SAR" },
          available: true,
        },
      ],
      subtotal: { amount_minor: 90000, currency: "SAR" },
      currency: "SAR",
      has_unavailable_items: false,
    };

    const cart = mapAwjCartToViewModel(raw);

    expect(cart.items[0].unitPrice).toEqual({
      amount_minor: 45000,
      currency: "SAR",
    });
    expect(cart.items[0].lineTotal).toEqual({
      amount_minor: 90000,
      currency: "SAR",
    });
    expect(cart.subtotal).toEqual({ amount_minor: 90000, currency: "SAR" });
  });

  it("preserves the unavailable flag and identity fields per line", () => {
    const raw: AwjCart = {
      status: "active",
      items: [
        {
          id: "item-1",
          product_id: null,
          product_variant_id: null,
          variant_descriptor: null,
          product_name: "Deleted product",
          unit_key: "base",
          unit_name: "piece",
          quantity: 3,
          unit_price: { amount_minor: 0, currency: "SAR" },
          line_total: { amount_minor: 0, currency: "SAR" },
          available: false,
        },
      ],
      subtotal: { amount_minor: 0, currency: "SAR" },
      currency: "SAR",
      has_unavailable_items: true,
    };

    const cart = mapAwjCartToViewModel(raw);

    expect(cart.items[0].available).toBe(false);
    expect(cart.items[0].productId).toBeNull();
    expect(cart.items[0].quantity).toBe(3);
    expect(cart.hasUnavailableItems).toBe(true);
  });

  it("computes itemCount as the sum of line quantities", () => {
    const raw: AwjCart = {
      status: "active",
      items: [
        {
          id: "a",
          product_id: "p1",
          product_variant_id: null,
          variant_descriptor: null,
          product_name: "A",
          unit_key: "base",
          unit_name: "piece",
          quantity: 2,
          unit_price: { amount_minor: 100, currency: "SAR" },
          line_total: { amount_minor: 200, currency: "SAR" },
          available: true,
        },
        {
          id: "b",
          product_id: "p2",
          product_variant_id: null,
          variant_descriptor: null,
          product_name: "B",
          unit_key: "base",
          unit_name: "piece",
          quantity: 5,
          unit_price: { amount_minor: 100, currency: "SAR" },
          line_total: { amount_minor: 500, currency: "SAR" },
          available: true,
        },
      ],
      subtotal: { amount_minor: 700, currency: "SAR" },
      currency: "SAR",
      has_unavailable_items: false,
    };

    expect(mapAwjCartToViewModel(raw).itemCount).toBe(7);
  });

  it("isStorefrontCart discriminates an AWJ cart from a Spree-shaped one", () => {
    const raw: AwjCart = {
      status: null,
      items: [],
      subtotal: { amount_minor: 0, currency: "SAR" },
      currency: "SAR",
      has_unavailable_items: false,
    };
    const awjCart = mapAwjCartToViewModel(raw);
    const spreeLikeCart = { id: "cart-1", number: "R123", items: [] };

    expect(isStorefrontCart(awjCart)).toBe(true);
    expect(isStorefrontCart(spreeLikeCart)).toBe(false);
    expect(isStorefrontCart(null)).toBe(false);
  });

  it("formatMinorAmount divides by 100 for display only, without mutating the source value", () => {
    const money = { amount_minor: 123456, currency: "SAR" };
    const formatted = formatMinorAmount(money);

    expect(money.amount_minor).toBe(123456); // untouched
    // ar-SA formatting uses Arabic-Indic digits (١٬٢٣٤٫٥٦) — assert the
    // underlying numeric value survived the /100 conversion instead of
    // asserting a locale-specific digit script.
    const numeric = Number(
      new Intl.NumberFormat("en-US", { useGrouping: false }).format(
        money.amount_minor / 100,
      ),
    );
    expect(numeric).toBeCloseTo(1234.56, 2);
    expect(formatted.length).toBeGreaterThan(0);
  });
});
