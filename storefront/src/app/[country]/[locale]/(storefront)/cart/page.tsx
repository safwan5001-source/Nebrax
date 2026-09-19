"use client";

import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { CartEmptyState } from "@/components/cart/CartEmptyState";
import { awjCartLineView, CartLine } from "@/components/cart/CartLine";
import { CartSummary } from "@/components/cart/CartSummary";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useCartLineImages } from "@/hooks/useCartLineImages";
import { localeDirection } from "@/i18n/locales";
import { trackViewCart } from "@/lib/analytics/gtm";
import { isStorefrontCart } from "@/lib/commerce/cart-types";
import { extractBasePath } from "@/lib/utils/path";

/**
 * STORE-UI-4 — the AWJ cart page.
 *
 * This route is the DTC surface's cart and is always AWJ-backed: the wholesale
 * surface has its own page (`(wholesale)/wholesale/cart`) bound to a Spree
 * provider, so nothing Spree-shaped can reach here. The narrowing below is the
 * guard for that, not a second design.
 *
 * **Mobile deliberately has no sticky checkout bar.** `MobileBottomNav` is
 * already fixed to the bottom of every storefront page, and a second fixed bar
 * would either sit on top of it or push it off the safe area. The summary and
 * its checkout action follow the lines inline instead, which on a cart — a
 * short, finite list the shopper scrolls to the end of anyway — reaches the
 * action just as fast without fighting the shell.
 */
export default function CartPage() {
  const { cart, loading, updating, updateItem, removeItem } = useCart();
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  const rtl = localeDirection(useLocale()) === "rtl";
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  const viewCartFiredRef = useRef(false);
  const awjCart = isStorefrontCart(cart) ? cart : null;

  // GA4's `view_cart` payload is modelled on Spree's Cart/Order shape
  // (item_total, discounts). AWJ carts do not fire it — adapting analytics is a
  // separate concern from presenting the cart, exactly as before this pass.
  useEffect(() => {
    if (
      !loading &&
      cart &&
      !isStorefrontCart(cart) &&
      cart.total_quantity > 0 &&
      !viewCartFiredRef.current
    ) {
      trackViewCart(cart);
      viewCartFiredRef.current = true;
    }
  }, [cart, loading]);

  const images = useCartLineImages(
    awjCart?.items.map((line) => line.productId) ?? [],
  );

  if (loading) {
    return <CartPageSkeleton />;
  }

  if (!awjCart || awjCart.items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-store px-4 sm:px-6 lg:px-8">
        <CartEmptyState basePath={basePath} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-store px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-store-border pb-4">
        <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
          {t("shoppingCart")}
        </h1>
        <span className="text-sm text-store-muted-foreground tabular-nums">
          {t("itemCount", { count: awjCart.itemCount })}
        </span>
      </header>

      {awjCart.hasUnavailableItems && (
        <div
          role="status"
          className="mt-5 flex items-start gap-3 rounded-store border border-store-warning/40 bg-store-warning/10 p-4"
        >
          <AlertTriangle
            className="mt-0.5 w-4 h-4 shrink-0 text-store-warning"
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-store-foreground">
            {t("unavailableItemsNotice")}
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <section
          aria-label={t("shoppingCart")}
          className="rounded-store border border-store-border bg-store-surface px-4 sm:px-5"
        >
          <ul className="divide-y divide-store-border">
            {awjCart.items.map((line) => (
              <li key={line.id}>
                <CartLine
                  view={awjCartLineView(
                    line,
                    basePath,
                    line.productId ? images[line.productId] : null,
                  )}
                  density="page"
                  disabled={updating}
                  onQuantityChange={(quantity) => updateItem(line.id, quantity)}
                  onRemove={() => removeItem(line.id)}
                />
              </li>
            ))}
          </ul>
        </section>

        <CartSummary
          subtotal={awjCart.subtotal}
          itemCount={awjCart.itemCount}
          sticky
          actions={
            <div className="space-y-2">
              <Button size="lg" asChild className="w-full">
                <Link href={`${basePath}/checkout`}>
                  {t("proceedToCheckout")}
                  <Arrow className="w-4 h-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button variant="ghost" asChild className="w-full">
                <Link href={`${basePath}/products`}>
                  {tc("continueShopping")}
                </Link>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}

function CartPageSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-store animate-pulse px-4 py-6 sm:px-6 lg:px-8 lg:py-10 motion-reduce:animate-none"
    >
      <div className="h-7 w-40 rounded bg-store-surface-muted" />
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="space-y-4 rounded-store border border-store-border bg-store-surface p-5">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-4">
              <div className="size-20 shrink-0 rounded-store bg-store-surface-muted sm:size-24" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-3/4 rounded bg-store-surface-muted" />
                <div className="h-3 w-1/3 rounded bg-store-surface-muted" />
              </div>
            </div>
          ))}
        </div>
        <div className="h-72 rounded-store border border-store-border bg-store-surface" />
      </div>
    </div>
  );
}
