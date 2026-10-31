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
import type { PurchaseIssue } from "@/lib/commerce/wholesale-buyer";
import {
  addAwjItem,
  getAwjCartState,
  removeAwjItem,
  updateAwjItem,
} from "@/lib/data/cart";

interface CartContextType {
  /** The AWJ-native cart (`StorefrontCart`) — the storefront's only cart authority. */
  cart: StorefrontCart | null;
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
   * `id` is the AWJ product id; `variantId` the chosen variant (`store/v1`
   * takes both). `unitKey` is the AWJ UOM identity, `"base"` unless the
   * catalog names another canonical unit.
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

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<StorefrontCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("cart");
  const tw = useTranslations("wholesaleBuyer");
  const [accessIssue, setAccessIssue] = useState<PurchaseIssue | null>(null);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const refreshCart = useCallback(async () => {
    try {
      const state = await getAwjCartState();
      setCart(state.cart);
      setAccessIssue(state.purchaseIssue ?? null);
    } catch {
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const mutateCart = useCallback(
    async (
      action: () => Promise<{
        success: boolean;
        cart?: StorefrontCart | null;
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
          addAwjItem(id, quantity, unitKey ?? "base", variantId, selections),
        t("failedToAddItem"),
        () => setIsOpen(true),
      );
    },
    [mutateCart, t],
  );

  const updateItem = useCallback(
    async (lineItemId: string, quantity: number) => {
      await mutateCart(
        () => updateAwjItem(lineItemId, quantity),
        t("failedToUpdateItem"),
      );
    },
    [mutateCart, t],
  );

  const removeItem = useCallback(
    async (lineItemId: string) => {
      await mutateCart(
        () => removeAwjItem(lineItemId),
        t("failedToRemoveItem"),
      );
    },
    [mutateCart, t],
  );

  // Re-fetch the cart on navigation (e.g. after checkout completes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the intended re-fetch trigger
  useEffect(() => {
    refreshCart();
  }, [refreshCart, pathname]);

  const itemCount = useMemo<number>(
    () =>
      cart?.items?.reduce(
        (sum: number, item: StorefrontCartLine) =>
          // An add-on rides on its parent line (ADR-18) and is not counted.
          item.addonOf ? sum : sum + item.quantity,
        0,
      ) ?? 0,
    [cart],
  );

  const value = useMemo<CartContextType>(
    () => ({
      cart,
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
