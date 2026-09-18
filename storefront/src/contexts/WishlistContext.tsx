"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { WISHLIST_CAPABILITY } from "@/lib/commerce/capabilities";

type ItemState = "idle" | "pending" | "error";

interface WishlistContextValue {
  isFavorite: (productId: string) => boolean;
  stateFor: (productId: string) => ItemState;
  toggle: (productId: string) => Promise<void>;
  /** False while the capability is `design_only` — nothing is persisted. */
  isLive: boolean;
  /** Product ids favourited for the life of this page. Empty after a reload. */
  favoriteIds: readonly string[];
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

/**
 * The single seam every favourites affordance goes through.
 *
 * **DESIGN_ONLY / GATED.** `store/v1` exposes no wishlist contract, so this
 * provider holds favourites in React state for the life of the page and
 * persists nothing — not to `localStorage`, not to a cookie. A favourite that
 * survived a reload would imply an account-level promise the platform has not
 * made; see `lib/commerce/capabilities.ts` for the exact missing contract.
 *
 * When that contract lands, only this provider changes: `toggle` calls the real
 * mutation, `isLive` becomes true, and no consuming component is touched. That
 * is the whole point of routing every heart through here.
 */
export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [states, setStates] = useState<Readonly<Record<string, ItemState>>>({});

  const isLive = WISHLIST_CAPABILITY === "live";

  const toggle = useCallback(async (productId: string) => {
    setStates((prev) => ({ ...prev, [productId]: "pending" }));

    // When the contract exists this is where the awaited mutation goes, and
    // a rejection reverts the optimistic flip below instead of keeping it.
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });

    setStates((prev) => ({ ...prev, [productId]: "idle" }));
  }, []);

  const value = useMemo<WishlistContextValue>(
    () => ({
      isFavorite: (productId: string) => favorites.has(productId),
      stateFor: (productId: string) => states[productId] ?? "idle",
      toggle,
      isLive,
      favoriteIds: Array.from(favorites),
    }),
    [favorites, states, toggle, isLive],
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

/** Null outside a provider, so a surface without favourites renders none. */
export function useWishlist(): WishlistContextValue | null {
  return useContext(WishlistContext);
}
