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

  it("addAwjCartItem sends gifting selections as snake_case, only non-empty, and never a price (FLOWERS-H11)", async () => {
    await addAwjCartItem("prod-123", 1, "base", "var-1", {
      personalization: { card_text: "Happy birthday", vase: "  ", note: "" },
      addons: [
        { productId: "addon-1", variantId: null, quantity: 2 },
        { productId: "addon-2", variantId: "addon-var", quantity: 1 },
        { productId: "addon-3", variantId: null, quantity: 0 },
      ],
    });

    expect(mocks.storefrontCartRequest).toHaveBeenCalledWith(
      "POST",
      "cart/items",
      {
        product_id: "prod-123",
        quantity: 1,
        unit_key: "base",
        product_variant_id: "var-1",
        personalization: { card_text: "Happy birthday" },
        addons: [
          { product_id: "addon-1", quantity: 2 },
          {
            product_id: "addon-2",
            product_variant_id: "addon-var",
            quantity: 1,
          },
        ],
      },
    );
    const body = mocks.storefrontCartRequest.mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(body)).not.toMatch(/price|amount/);
  });

  it("addAwjCartItem omits personalization and addons entirely when nothing was chosen", async () => {
    await addAwjCartItem("prod-123", 1, "base", null, {
      personalization: { a: "   " },
      addons: [{ productId: "x", variantId: null, quantity: 0 }],
    });

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
