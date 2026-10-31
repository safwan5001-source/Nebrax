import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAwjCartAdapter = vi.hoisted(() => ({
  fetchAwjCart: vi.fn(),
  addAwjCartItem: vi.fn(),
  updateAwjCartItem: vi.fn(),
  removeAwjCartItem: vi.fn(),
}));

vi.mock("@/lib/commerce/cart", () => mockAwjCartAdapter);

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addAwjItem,
  getAwjCart,
  removeAwjItem,
  updateAwjItem,
} from "@/lib/data/cart";

describe("cart server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is AWJ-only: the module never imports the Spree wrapper, SDK or checkout/payment data layers", () => {
    const source = readFileSync(join(__dirname, "../cart.ts"), "utf-8");
    expect(source).not.toMatch(/@\/lib\/spree|@spree\//);
  });

  describe("AWJ cart actions", () => {
    beforeEach(() => {
      mockAwjCartAdapter.fetchAwjCart.mockReset();
      mockAwjCartAdapter.addAwjCartItem.mockReset();
      mockAwjCartAdapter.updateAwjCartItem.mockReset();
      mockAwjCartAdapter.removeAwjCartItem.mockReset();
    });

    it("getAwjCart returns the AWJ view model", async () => {
      const awjCart = { kind: "awj" as const, items: [] };
      mockAwjCartAdapter.fetchAwjCart.mockResolvedValue(awjCart);

      const result = await getAwjCart();

      expect(result).toBe(awjCart);
    });

    it("getAwjCart returns null (not a thrown error) when the fetch fails", async () => {
      mockAwjCartAdapter.fetchAwjCart.mockRejectedValue(new Error("boom"));

      await expect(getAwjCart()).resolves.toBeNull();
    });

    it("addAwjItem forwards product id, quantity, unit key and wraps the result", async () => {
      const awjCart = { kind: "awj" as const, items: [{ id: "i1" }] };
      mockAwjCartAdapter.addAwjCartItem.mockResolvedValue(awjCart);

      const result = await addAwjItem("prod-1", 2, "unit:xyz");

      expect(mockAwjCartAdapter.addAwjCartItem).toHaveBeenCalledWith(
        "prod-1",
        2,
        "unit:xyz",
        undefined,
        undefined,
      );
      expect(result).toEqual({ success: true, cart: awjCart });
    });

    it("addAwjItem forwards the chosen variant id", async () => {
      const awjCart = { kind: "awj" as const, items: [{ id: "i1" }] };
      mockAwjCartAdapter.addAwjCartItem.mockResolvedValue(awjCart);

      await addAwjItem("prod-1", 1, "base", "variant-9");

      expect(mockAwjCartAdapter.addAwjCartItem).toHaveBeenCalledWith(
        "prod-1",
        1,
        "base",
        "variant-9",
        undefined,
      );
    });

    it("addAwjItem returns a failure result instead of throwing", async () => {
      mockAwjCartAdapter.addAwjCartItem.mockRejectedValue(
        new Error("لا يوجد سعر معتمد لهذه الوحدة."),
      );

      const result = await addAwjItem("prod-1", 1);

      expect(result).toEqual({
        success: false,
        error: "لا يوجد سعر معتمد لهذه الوحدة.",
      });
    });

    it("updateAwjItem forwards the AWJ item id and quantity only", async () => {
      const awjCart = { kind: "awj" as const, items: [] };
      mockAwjCartAdapter.updateAwjCartItem.mockResolvedValue(awjCart);

      const result = await updateAwjItem("item-1", 7);

      expect(mockAwjCartAdapter.updateAwjCartItem).toHaveBeenCalledWith(
        "item-1",
        7,
      );
      expect(result).toEqual({ success: true, cart: awjCart });
    });

    it("removeAwjItem forwards the AWJ item id", async () => {
      const awjCart = { kind: "awj" as const, items: [] };
      mockAwjCartAdapter.removeAwjCartItem.mockResolvedValue(awjCart);

      const result = await removeAwjItem("item-1");

      expect(mockAwjCartAdapter.removeAwjCartItem).toHaveBeenCalledWith(
        "item-1",
      );
      expect(result).toEqual({ success: true, cart: awjCart });
    });
  });
});
