import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/cart", () => ({
  getAwjCart: vi.fn(),
  addAwjItem: vi.fn(),
  updateAwjItem: vi.fn(),
  removeAwjItem: vi.fn(),
  getCart: vi.fn(),
  addToCart: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { toast } from "sonner";
import { CartProvider, useCart } from "@/contexts/CartContext";
import {
  addAwjItem,
  addToCart,
  getAwjCart,
  getCart,
  removeAwjItem,
  removeCartItem,
  updateAwjItem,
  updateCartItem,
} from "@/lib/data/cart";

const mockGetAwjCart = vi.mocked(getAwjCart);
const mockAddAwjItem = vi.mocked(addAwjItem);
const mockUpdateAwjItem = vi.mocked(updateAwjItem);
const mockRemoveAwjItem = vi.mocked(removeAwjItem);
const mockGetCart = vi.mocked(getCart);
const mockAddToCart = vi.mocked(addToCart);
const mockUpdateCartItem = vi.mocked(updateCartItem);
const mockRemoveCartItem = vi.mocked(removeCartItem);
const mockToastError = vi.mocked(toast.error);

const mockCart = {
  kind: "awj" as const,
  items: [
    { id: "li-1", quantity: 2, name: "Shirt" },
    { id: "li-2", quantity: 1, name: "Pants" },
  ],
} as never;

const updatedCart = {
  kind: "awj" as const,
  items: [
    { id: "li-1", quantity: 2, name: "Shirt" },
    { id: "li-2", quantity: 1, name: "Pants" },
    { id: "li-3", quantity: 1, name: "Hat" },
  ],
} as never;

function wrapper({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

function wholesaleWrapper({ children }: { children: ReactNode }) {
  return <CartProvider surface="wholesale">{children}</CartProvider>;
}

const spreeCart = {
  id: "cart-1",
  items: [{ id: "li-1", quantity: 2, name: "Shirt" }],
} as never;

describe("CartContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAwjCart.mockResolvedValue(mockCart);
    mockGetCart.mockResolvedValue(spreeCart);
  });

  it("throws when used outside CartProvider", () => {
    expect(() => {
      renderHook(() => useCart());
    }).toThrow("useCart must be used within a CartProvider");
  });

  it("loads the AWJ cart on mount for the default (dtc) surface", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetAwjCart).toHaveBeenCalledOnce();
    expect(mockGetCart).not.toHaveBeenCalled();
    expect(result.current.cart).toBe(mockCart);
    expect(result.current.surface).toBe("dtc");
  });

  it("computes itemCount from cart items", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.itemCount).toBe(3); // 2 + 1
  });

  it("sets cart to null when initial load fails", async () => {
    mockGetAwjCart.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.cart).toBeNull();
    expect(result.current.itemCount).toBe(0);
  });

  describe("addItem (dtc/AWJ)", () => {
    it("sends the AWJ product id, quantity, and unit key; opens the drawer on success", async () => {
      mockAddAwjItem.mockResolvedValue({
        success: true as const,
        cart: updatedCart,
      });

      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addItem("product-1", 2, "unit:abc");
      });

      expect(mockAddAwjItem).toHaveBeenCalledWith("product-1", 2, "unit:abc");
      expect(mockAddToCart).not.toHaveBeenCalled();
      expect(result.current.cart).toBe(updatedCart);
      expect(result.current.isOpen).toBe(true);
      expect(result.current.updating).toBe(false);
    });

    it("defaults the unit key to base when omitted", async () => {
      mockAddAwjItem.mockResolvedValue({
        success: true as const,
        cart: updatedCart,
      });

      const { result } = renderHook(() => useCart(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.addItem("product-1", 1);
      });

      expect(mockAddAwjItem).toHaveBeenCalledWith("product-1", 1, "base");
    });

    it("never sends a price — only product id, quantity, unit key", async () => {
      mockAddAwjItem.mockResolvedValue({
        success: true as const,
        cart: updatedCart,
      });
      const { result } = renderHook(() => useCart(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.addItem("product-1", 1);
      });

      const call = mockAddAwjItem.mock.calls[0];
      expect(call).toHaveLength(3);
      expect(call).toEqual(["product-1", 1, "base"]);
    });

    it("shows error toast and does not update cart on failure", async () => {
      mockAddAwjItem.mockResolvedValue({
        success: false as const,
        error: "Out of stock",
      });

      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addItem("product-1");
      });

      expect(result.current.cart).toBe(mockCart); // unchanged
      expect(mockToastError).toHaveBeenCalledWith("Out of stock");
    });

    it("shows fallback toast when server error message is empty", async () => {
      mockAddAwjItem.mockResolvedValue({
        success: false as const,
        error: "",
      });

      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addItem("product-1");
      });

      expect(mockToastError).toHaveBeenCalledWith("failedToAddItem");
    });
  });

  describe("updateItem (dtc/AWJ)", () => {
    it("updates cart on success via the AWJ item id and quantity", async () => {
      mockUpdateAwjItem.mockResolvedValue({
        success: true as const,
        cart: updatedCart,
      });

      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateItem("li-1", 5);
      });

      expect(mockUpdateAwjItem).toHaveBeenCalledWith("li-1", 5);
      expect(mockUpdateCartItem).not.toHaveBeenCalled();
      expect(result.current.cart).toBe(updatedCart);
      expect(result.current.updating).toBe(false);
    });
  });

  describe("removeItem (dtc/AWJ)", () => {
    it("updates cart on success via the AWJ item id", async () => {
      const cartAfterRemoval = {
        kind: "awj" as const,
        items: [{ id: "li-2", quantity: 1, name: "Pants" }],
      } as never;

      mockRemoveAwjItem.mockResolvedValue({
        success: true as const,
        cart: cartAfterRemoval,
      });

      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.removeItem("li-1");
      });

      expect(mockRemoveAwjItem).toHaveBeenCalledWith("li-1");
      expect(mockRemoveCartItem).not.toHaveBeenCalled();
      expect(result.current.cart).toBe(cartAfterRemoval);
      expect(result.current.itemCount).toBe(1);
    });
  });

  describe("wholesale surface stays Spree-backed", () => {
    it("loads via the Spree getCart, never the AWJ adapter", async () => {
      const { result } = renderHook(() => useCart(), {
        wrapper: wholesaleWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetCart).toHaveBeenCalledWith(undefined, "wholesale");
      expect(mockGetAwjCart).not.toHaveBeenCalled();
      expect(result.current.cart).toBe(spreeCart);
      expect(result.current.surface).toBe("wholesale");
    });

    it("addItem calls the Spree addToCart with the variant id and surface, no unit key", async () => {
      mockAddToCart.mockResolvedValue({
        success: true as const,
        cart: spreeCart,
      });

      const { result } = renderHook(() => useCart(), {
        wrapper: wholesaleWrapper,
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.addItem("variant-1", 2);
      });

      expect(mockAddToCart).toHaveBeenCalledWith("variant-1", 2, "wholesale");
      expect(mockAddAwjItem).not.toHaveBeenCalled();
    });
  });

  describe("openCart / closeCart", () => {
    it("toggles isOpen", async () => {
      const { result } = renderHook(() => useCart(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isOpen).toBe(false);

      act(() => {
        result.current.openCart();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.closeCart();
      });
      expect(result.current.isOpen).toBe(false);
    });
  });
});
