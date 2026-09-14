import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAwjCartAdapter = vi.hoisted(() => ({
  fetchAwjCart: vi.fn(),
  addAwjCartItem: vi.fn(),
  updateAwjCartItem: vi.fn(),
  removeAwjCartItem: vi.fn(),
}));

vi.mock("@/lib/commerce/cart", () => mockAwjCartAdapter);

const mockClient = {
  carts: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    associate: vi.fn(),
    items: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  channel: {
    get: vi.fn().mockResolvedValue({ id: "ch-dtc", code: "public" }),
  },
};

const { mockGetCartId } = vi.hoisted(() => ({ mockGetCartId: vi.fn() }));

vi.mock("@/lib/spree", () => ({
  getClient: () => mockClient,
  getClientForSurface: vi.fn(() => mockClient),
  cacheTagSuffix: () => "",
  DEFAULT_SURFACE: "dtc",
  isWholesaleEnabled: vi.fn().mockReturnValue(false),
  getCartToken: vi.fn().mockResolvedValue("order-token-123"),
  // Surface-aware default is (re)installed in beforeEach — clearAllMocks resets
  // implementations, so setting it here would not survive.
  getCartId: mockGetCartId,
  getAccessToken: vi.fn().mockResolvedValue(undefined),
  getLocaleOptions: vi.fn().mockResolvedValue({ locale: "en", country: "us" }),
  setCartCookies: vi.fn(),
  clearCartCookies: vi.fn(),
  // Real logic against the mocked getCartId — the DTC cookie is poisoned when
  // it holds the wholesale cart's id.
  isPoisonedDtcCartId: async (cartId: string, surface: string) => {
    if (surface !== "dtc") return false;
    const wholesaleCartId = await mockGetCartId("wholesale");
    return Boolean(wholesaleCartId) && wholesaleCartId === cartId;
  },
  getCartOptions: vi.fn().mockResolvedValue({
    spreeToken: "order-token-123",
    token: undefined,
  }),
  requireCartId: vi.fn().mockResolvedValue("cart-1"),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

import {
  addAwjItem,
  addToCart,
  associateCartWithUser,
  clearCart,
  getAwjCart,
  getCart,
  getOrCreateCart,
  removeAwjItem,
  removeCartItem,
  updateAwjItem,
  updateCartItem,
} from "@/lib/data/cart";

// Minimal cart fixture for tests
const mockCart = {
  id: "cart-1",
  number: "R123456",
  state: "cart",
  token: "order-token-123",
  items: [],
  total: "0.00",
};

describe("cart server actions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Surface-aware cart-id cookie: only DTC has one by default, so the
    // cross-surface poison guard sees no wholesale cookie to collide with.
    const { getCartId } = await import("@/lib/spree");
    (getCartId as ReturnType<typeof vi.fn>).mockImplementation(
      async (surface = "dtc") =>
        surface === "wholesale" ? undefined : "cart-1",
    );
  });

  describe("getCart", () => {
    it("returns null for a fresh visitor without constructing the Spree client (COM-7-PREVIEW-FIX-1)", async () => {
      const { getClientForSurface, getCartId, getAccessToken } = await import(
        "@/lib/spree"
      );
      (getCartId as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const getClientForSurfaceSpy = vi.mocked(getClientForSurface);
      getClientForSurfaceSpy.mockClear();

      const result = await getCart();

      expect(result).toBeNull();
      // A read-only preview visitor with no cart cookie and no auth token
      // must never require SPREE_API_URL/SPREE_PUBLISHABLE_KEY to be
      // configured — getClientForSurface() throws when they are unset.
      expect(getClientForSurfaceSpy).not.toHaveBeenCalled();
    });

    it("fetches cart by ID and token", async () => {
      mockClient.carts.get.mockResolvedValue(mockCart);
      const result = await getCart();
      expect(mockClient.carts.get).toHaveBeenCalledWith("cart-1", {
        spreeToken: "order-token-123",
        token: undefined,
      });
      expect(result).toBe(mockCart);
    });

    it("drops a DTC cookie poisoned with the wholesale cart id and returns null", async () => {
      const { getCartId, clearCartCookies } = await import("@/lib/spree");
      // Both surfaces' cookies point at the same cart — the pre-fix poisoning.
      (getCartId as ReturnType<typeof vi.fn>).mockResolvedValue("cart-1");

      const result = await getCart(undefined, "dtc");

      expect(result).toBeNull();
      expect(mockClient.carts.get).not.toHaveBeenCalled();
      expect(clearCartCookies).toHaveBeenCalledWith("dtc");
    });

    it("keeps the wholesale cart even when the DTC cookie collides (directional guard)", async () => {
      const { getCartId } = await import("@/lib/spree");
      (getCartId as ReturnType<typeof vi.fn>).mockResolvedValue("cart-1");
      mockClient.carts.get.mockResolvedValue(mockCart);

      const result = await getCart(undefined, "wholesale");

      expect(result).toBe(mockCart);
    });

    it("drops a cookie cart whose channel_id does not match the surface", async () => {
      const { clearCartCookies } = await import("@/lib/spree");
      mockClient.carts.get.mockResolvedValue({
        ...mockCart,
        channel_id: "ch-wholesale",
      });
      // DTC surface resolves to ch-dtc (mockClient.channel.get), so ch-wholesale
      // is a confirmed mismatch.
      const result = await getCart(undefined, "dtc");

      expect(result).toBeNull();
      expect(clearCartCookies).toHaveBeenCalledWith("dtc");
    });

    it("keeps a cookie cart whose channel_id matches the surface", async () => {
      mockClient.carts.get.mockResolvedValue({
        ...mockCart,
        channel_id: "ch-dtc",
      });
      const result = await getCart(undefined, "dtc");

      expect(result).toMatchObject({ id: "cart-1" });
    });
  });

  describe("getOrCreateCart", () => {
    it("returns existing cart if found", async () => {
      mockClient.carts.get.mockResolvedValue(mockCart);
      const result = await getOrCreateCart();
      expect(result).toBe(mockCart);
      expect(mockClient.carts.create).not.toHaveBeenCalled();
    });

    it("passes locale options when creating a new cart", async () => {
      const { getCartId, getLocaleOptions } = await import("@/lib/spree");
      (getCartId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      (getLocaleOptions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        locale: "de",
        country: "de",
      });
      mockClient.carts.create.mockResolvedValue(mockCart);

      await getOrCreateCart();

      expect(mockClient.carts.create).toHaveBeenCalledWith(undefined, {
        locale: "de",
        country: "de",
      });
    });
  });

  describe("addToCart", () => {
    it("returns success with cart", async () => {
      mockClient.carts.get.mockResolvedValue(mockCart);
      mockClient.carts.items.create.mockResolvedValue(mockCart);

      const result = await addToCart("variant-1", 2);

      expect(mockClient.carts.items.create).toHaveBeenCalledWith(
        "cart-1",
        { variant_id: "variant-1", quantity: 2 },
        { spreeToken: "order-token-123", token: undefined },
      );
      expect(result).toEqual({ success: true, cart: mockCart });
    });

    it("returns error when addItem throws", async () => {
      mockClient.carts.get.mockResolvedValue(mockCart);
      mockClient.carts.items.create.mockRejectedValue(
        new Error("Variant not found"),
      );

      const result = await addToCart("bad-variant", 1);

      expect(result).toEqual({
        success: false,
        error: "Variant not found",
      });
    });

    it("returns fallback message for non-Error throws", async () => {
      mockClient.carts.get.mockResolvedValue(mockCart);
      mockClient.carts.items.create.mockRejectedValue("unexpected");

      const result = await addToCart("variant-1", 1);

      expect(result).toEqual({
        success: false,
        error: "Failed to add item to cart",
      });
    });
  });

  describe("updateCartItem", () => {
    it("returns success with refreshed cart", async () => {
      mockClient.carts.items.update.mockResolvedValue(mockCart);

      const result = await updateCartItem("li-1", 3);

      expect(mockClient.carts.items.update).toHaveBeenCalledWith(
        "cart-1",
        "li-1",
        { quantity: 3 },
        { spreeToken: "order-token-123", token: undefined },
      );
      expect(result).toEqual({ success: true, cart: mockCart });
    });

    it("returns error on failure", async () => {
      mockClient.carts.items.update.mockRejectedValue(
        new Error("Insufficient stock"),
      );

      const result = await updateCartItem("li-1", 999);

      expect(result).toEqual({
        success: false,
        error: "Insufficient stock",
      });
    });
  });

  describe("removeCartItem", () => {
    it("returns success with refreshed cart", async () => {
      mockClient.carts.items.delete.mockResolvedValue(mockCart);

      const result = await removeCartItem("li-1");

      expect(mockClient.carts.items.delete).toHaveBeenCalledWith(
        "cart-1",
        "li-1",
        {
          spreeToken: "order-token-123",
          token: undefined,
        },
      );
      expect(result).toEqual({ success: true, cart: mockCart });
    });

    it("returns error on failure", async () => {
      mockClient.carts.items.delete.mockRejectedValue(
        new Error("Item not found"),
      );

      const result = await removeCartItem("li-999");

      expect(result).toEqual({
        success: false,
        error: "Item not found",
      });
    });
  });

  describe("clearCart", () => {
    it("returns success", async () => {
      const result = await clearCart();
      expect(result).toEqual({ success: true });
    });
  });

  describe("associateCartWithUser", () => {
    it("returns success", async () => {
      const { getAccessToken } = await import("@/lib/spree");
      (getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(
        "jwt-token",
      );
      mockClient.carts.associate.mockResolvedValue({});

      const result = await associateCartWithUser();

      expect(result).toEqual({ success: true });
    });
  });

  describe("AWJ Cart V1 actions (DTC surface) — never touch the Spree client", () => {
    beforeEach(() => {
      mockAwjCartAdapter.fetchAwjCart.mockReset();
      mockAwjCartAdapter.addAwjCartItem.mockReset();
      mockAwjCartAdapter.updateAwjCartItem.mockReset();
      mockAwjCartAdapter.removeAwjCartItem.mockReset();
    });

    it("getAwjCart returns the AWJ view model without calling any Spree client method", async () => {
      const awjCart = { kind: "awj" as const, items: [] };
      mockAwjCartAdapter.fetchAwjCart.mockResolvedValue(awjCart);

      const result = await getAwjCart();

      expect(result).toBe(awjCart);
      expect(mockClient.carts.get).not.toHaveBeenCalled();
      expect(mockClient.carts.create).not.toHaveBeenCalled();
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
      );
      expect(result).toEqual({ success: true, cart: awjCart });
      expect(mockClient.carts.items.create).not.toHaveBeenCalled();
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
