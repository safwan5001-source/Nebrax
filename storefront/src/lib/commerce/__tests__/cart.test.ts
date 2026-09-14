import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storefrontCartRequest: vi.fn(),
}));

vi.mock("../config", () => ({
  storefrontCartRequest: mocks.storefrontCartRequest,
}));

const { addAwjCartItem, fetchAwjCart, removeAwjCartItem, updateAwjCartItem } =
  await import("../cart");

const emptyAwjCart = {
  status: null,
  items: [],
  subtotal: { amount_minor: 0, currency: "SAR" },
  currency: "SAR",
  has_unavailable_items: false,
};

describe("commerce/cart — AWJ Cart V1 client", () => {
  beforeEach(() => {
    mocks.storefrontCartRequest.mockReset();
    mocks.storefrontCartRequest.mockResolvedValue({
      data: emptyAwjCart,
      meta: { request_id: "req-1" },
    });
  });

  it("fetchAwjCart issues a GET to cart and returns the mapped view model — never creates a cart", async () => {
    const cart = await fetchAwjCart();

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith("GET", "cart");
    expect(cart.kind).toBe("awj");
    expect(cart.items).toEqual([]);
  });

  it("addAwjCartItem POSTs product_id, quantity, and unit_key — no price field", async () => {
    await addAwjCartItem("prod-123", 3, "unit:abc");

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "POST",
      "cart/items",
      { product_id: "prod-123", quantity: 3, unit_key: "unit:abc" },
    );
  });

  it("addAwjCartItem defaults unit_key to base when omitted", async () => {
    await addAwjCartItem("prod-123", 1);

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "POST",
      "cart/items",
      { product_id: "prod-123", quantity: 1, unit_key: "base" },
    );
  });

  it("updateAwjCartItem PATCHes the AWJ cart item id with only quantity", async () => {
    await updateAwjCartItem("item-9", 5);

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "cart/items/item-9",
      { quantity: 5 },
    );
  });

  it("removeAwjCartItem DELETEs by the AWJ cart item id", async () => {
    await removeAwjCartItem("item-9");

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "DELETE",
      "cart/items/item-9",
    );
  });

  it("URL-encodes the item id in the path", async () => {
    await updateAwjCartItem("weird id/slash", 1);

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "PATCH",
      "cart/items/weird%20id%2Fslash",
      { quantity: 1 },
    );
  });
});
