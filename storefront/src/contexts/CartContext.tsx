"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import type {
  StorefrontCart,
  StorefrontCartLine,
} from "@/lib/commerce/cart-types";
import type { PdpSelections } from "@/lib/commerce/pdp-gifting";
import type { Surface } from "@/lib/commerce/surface";
import type { StoreCart, StoreCartLine } from "@/lib/commerce/types";
import type { PurchaseIssue } from "@/lib/commerce/wholesale-buyer";
import {
  addAwjItem,
  addToCart as addToCartAction,
  getAwjCartState,
  getCart as getCartAction,
  removeAwjItem,
  removeCartItem as removeCartItemAction,
  updateAwjItem,
  updateCartItem as updateCartItemAction,
} from "@/lib/data/cart";

/**
 * The DTC surface's cart is AWJ-native (`StorefrontCart`); wholesale stays
 * Spree-backed (`Cart`) — see `@/lib/data/cart`'s module doc. Components
 * that only ever run under one surface's `<CartProvider>` narrow this with
 * `isStorefrontCart()` (`@/lib/commerce/cart-types`) or a direct cast when
 * they are provably Spree-only (wholesale-specific views, the pre-existing
 * Spree checkout flow) — see AWJ_CART_WIRING's Spree-boundary notes.
 */
export type AnyCart = StoreCart | StorefrontCart;

interface CartContextType {
  cart: AnyCart | null;
  /** Which surface this provider's cart belongs to — "dtc" carts are AWJ-native. */
  surface: Surface;
  loading: boolean;
  updating: boolean;
  itemCount: number;
  /**
   * H6 Batch K — set only when the cart cannot be read or changed because of the buyer's wholesale standing
   * (`sign_in_required`, `approval_required`, `unavailable_for_wholesale`). Always `null` for a DTC visitor.
   */
  accessIssue: PurchaseIssue | null;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  /**
   * `id` is a Spree variant id on the wholesale surface, an AWJ product id
   * on the DTC surface. `unitKey` is DTC-only (AWJ UOM identity,
   * `"base"` unless the catalog names another canonical unit) and ignored
   * on the wholesale surface.
   */
  addItem: (
    id: string,
    quantity?: number,
    unitKey?: string,
    variantId?: string | null,
    selections?: PdpSelections,
  ) => Promise<void>;
  updateItem: (lineItemId: string, quantity: number) => Promise<void>;
  removeItem: (lineItemId: string) => Promise<void>;
  refreshCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({
  children,
  surface = "dtc",
}: {
  children: ReactNode;
  /** Which surface's cart this provider manages. Defaults to the DTC cart. */
  surface?: Surface;
}) {
  const [cart, setCart] = useState<AnyCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("cart");
  const tw = useTranslations("wholesaleBuyer");
  const [accessIssue, setAccessIssue] = useState<PurchaseIssue | null>(null);
  const isAwj = surface === "dtc";

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const refreshCart = useCallback(async () => {
    try {
      if (isAwj) {
        const state = await getAwjCartState();
        setCart(state.cart);
        setAccessIssue(state.purchaseIssue ?? null);
      } else {
        setCart(await getCartAction(undefined, surface));
      }
    } catch {
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, [surface, isAwj]);

  const mutateCart = useCallback(
    async (
      action: () => Promise<{
        success: boolean;
        cart?: AnyCart | null;
        error?: string;
        purchaseIssue?: PurchaseIssue;
      }>,
      fallbackMessage: string,
      onSuccess?: () => void,
    ) => {
      setUpdating(true);
      try {
        const result = await action();
        if (result.success) {
          setCart(result.cart ?? null);
          onSuccess?.();
          router.refresh();
        } else if (result.purchaseIssue) {
          // A wholesale refusal: the store's own localized wording, never the backend's text, and the cart shows why.
          setAccessIssue(result.purchaseIssue);
          toast.error(tw(`purchase.${result.purchaseIssue}`));
        } else {
          toast.error(result.error || fallbackMessage);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : fallbackMessage);
      } finally {
        setUpdating(false);
      }
    },
    [router, tw],
  );

  const addItem = useCallback(
    async (
      id: string,
      quantity = 1,
      unitKey?: string,
      variantId?: string | null,
      selections?: PdpSelections,
    ) => {
      await mutateCart(
        () =>
          isAwj
            ? // On the AWJ surface `id` is the product and `variantId` the
              // chosen variant, because `store/v1` takes both. On the Spree
              // surface `id` is already a variant id and there is no second
              // identifier to pass.
              addAwjItem(id, quantity, unitKey ?? "base", variantId, selections)
            : addToCartAction(id, quantity, surface),
        t("failedToAddItem"),
        () => setIsOpen(true),
      );
    },
    [mutateCart, t, surface, isAwj],
  );

  const updateItem = useCallback(
    async (lineItemId: string, quantity: number) => {
      await mutateCart(
        () =>
          isAwj
            ? updateAwjItem(lineItemId, quantity)
            : updateCartItemAction(lineItemId, quantity, surface),
        t("failedToUpdateItem"),
      );
    },
    [mutateCart, t, surface, isAwj],
  );

  const removeItem = useCallback(
    async (lineItemId: string) => {
      await mutateCart(
        () =>
          isAwj
            ? removeAwjItem(lineItemId)
            : removeCartItemAction(lineItemId, surface),
        t("failedToRemoveItem"),
      );
    },
    [mutateCart, t, surface, isAwj],
  );

  // Re-fetch cart on navigation (e.g., after checkout completes, the stale
  // cart token will be cleared by getCart and the cart state will update).
  // On the order-placed page, skip refreshCart to avoid a race condition:
  // getCart() auto-clears the cart token cookie on error (completed order
  // is no longer a cart), which removes the only auth token guest users
  // have before getCheckoutOrder() can use it.
  useEffect(() => {
    if (pathname.includes("/order-placed/")) {
      setCart(null);
      setLoading(false);
      return;
    }
    refreshCart();
  }, [refreshCart, pathname]);

  const itemCount = useMemo<number>(
    () =>
      cart?.items?.reduce(
        (sum: number, item: StoreCartLine | StorefrontCartLine) =>
          // An add-on rides on its parent line (ADR-18) and is not counted.
          "addonOf" in item && item.addonOf ? sum : sum + item.quantity,
        0,
      ) ?? 0,
    [cart],
  );

  const value = useMemo<CartContextType>(
    () => ({
      cart,
      surface,
      loading,
      updating,
      itemCount,
      accessIssue,
      isOpen,
      openCart,
      closeCart,
      addItem,
      updateItem,
      removeItem,
      refreshCart,
    }),
    [
      cart,
      surface,
      loading,
      updating,
      itemCount,
      accessIssue,
      isOpen,
      openCart,
      closeCart,
      addItem,
      updateItem,
      removeItem,
      refreshCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
