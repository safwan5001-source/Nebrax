"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWishlist } from "@/contexts/WishlistContext";
import { cn } from "@/lib/utils";

interface WishlistButtonProps {
  productId: string;
  /** `card` sits over the image; `detail` sits beside the product name. */
  variant?: "card" | "detail";
  className?: string;
}

/**
 * The favourites affordance.
 *
 * **DESIGN_ONLY / GATED** — see `WishlistProvider`. It renders nothing at all
 * outside a provider, so a surface that has not opted in shows no heart rather
 * than a dead control.
 *
 * States: default (outline), selected (filled, primary), hover, focus-visible,
 * pending (reduced opacity, non-interactive) and error, which reverts the flip
 * rather than leaving a favourite the server never accepted.
 */
export function WishlistButton({
  productId,
  variant = "card",
  className,
}: WishlistButtonProps) {
  const wishlist = useWishlist();
  const t = useTranslations("products");

  if (!wishlist) return null;

  const isFavorite = wishlist.isFavorite(productId);
  const state = wishlist.stateFor(productId);
  const pending = state === "pending";

  return (
    <button
      type="button"
      // Above the card's stretched link, which otherwise swallows the click.
      className={cn(
        "relative z-10 grid place-items-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-foreground",
        variant === "card"
          ? "size-8 bg-store-surface/90 text-store-muted-foreground shadow-2xs backdrop-blur hover:text-store-primary"
          : "size-10 border border-store-border bg-store-surface text-store-muted-foreground hover:border-store-border-strong hover:text-store-primary",
        isFavorite && "text-store-primary",
        pending && "pointer-events-none opacity-60",
        className,
      )}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? t("removeFromFavorites") : t("addToFavorites")}
      disabled={pending}
      onClick={(event) => {
        // The card is one big link; favouriting is not navigation.
        event.preventDefault();
        event.stopPropagation();
        void wishlist.toggle(productId);
      }}
    >
      <Heart
        aria-hidden="true"
        className={cn(
          "size-4 transition-transform motion-reduce:transition-none",
          variant === "detail" && "size-5",
          isFavorite && "fill-current",
        )}
      />
    </button>
  );
}
