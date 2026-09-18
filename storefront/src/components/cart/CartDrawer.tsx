"use client";

import type { Cart, LineItem } from "@spree/sdk";
import { ShoppingBag, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CartEmptyState } from "@/components/cart/CartEmptyState";
import {
  awjCartLineView,
  CartLine,
  type CartLineView,
} from "@/components/cart/CartLine";
import { CouponField } from "@/components/cart/CouponField";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCart } from "@/contexts/CartContext";
import { useCartLineImages } from "@/hooks/useCartLineImages";
import { localeDirection } from "@/i18n/locales";
import { trackRemoveFromCart, trackViewCart } from "@/lib/analytics/gtm";
import { formatMinorAmount, isStorefrontCart } from "@/lib/commerce/cart-types";
import { extractBasePath } from "@/lib/utils/path";

const ExpressCheckoutButton = dynamic(
  () =>
    import("@/components/checkout/ExpressCheckoutButton").then((m) => ({
      default: m.ExpressCheckoutButton,
    })),
  { ssr: false },
);

/**
 * The cart quick-access surface.
 *
 * Two providers mount this: the root layout's DTC `<CartProvider>` (AWJ carts)
 * and `WholesaleGate`'s `<CartProvider surface="wholesale">` (Spree carts). Both
 * render the same `CartLine` through their own adapter, so the drawer is one
 * design over two authorities rather than two drawers.
 *
 * It is a **view of the cart, not a second cart**: it shows the same lines, the
 * same server-sent subtotal and the same honesty about what is not priced yet as
 * the cart page. It never computes a total (see `CartSummary`'s doc for why).
 */
export function CartDrawer() {
  const {
    cart,
    loading,
    updating,
    isOpen,
    closeCart,
    updateItem,
    removeItem,
    itemCount,
    refreshCart,
  } = useCart();
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  // The drawer always enters from the "end" edge — left in Arabic, right in
  // English — matching where the header's cart button sits.
  const drawerSide = localeDirection(useLocale()) === "rtl" ? "left" : "right";
  const [expressProcessing, setExpressProcessing] = useState(false);
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const viewCartFiredRef = useRef(false);
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      closeCart();
      setExpressProcessing(false);
    }
  }, [pathname, closeCart]);

  const awjCart = isStorefrontCart(cart) ? cart : null;
  const spreeCart = cart && !isStorefrontCart(cart) ? (cart as Cart) : null;

  // AWJ carts do not fire GA4 `view_cart` — see the cart page's identical note.
  useEffect(() => {
    if (
      isOpen &&
      spreeCart &&
      spreeCart.total_quantity > 0 &&
      !viewCartFiredRef.current
    ) {
      trackViewCart(spreeCart);
      viewCartFiredRef.current = true;
    }
    if (!isOpen) {
      viewCartFiredRef.current = false;
    }
  }, [isOpen, spreeCart]);

  // Only fetched while the drawer is actually open — a closed drawer requests
  // no imagery.
  const images = useCartLineImages(
    awjCart?.items.map((line) => line.productId) ?? [],
    isOpen,
  );

  const isEmpty = (cart?.items?.length ?? 0) === 0;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeCart();
          setExpressProcessing(false);
        }
      }}
    >
      <SheetContent
        side={drawerSide}
        className="flex w-full flex-col gap-0 bg-store-background p-0 sm:max-w-md"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b border-store-border bg-store-surface px-4 py-3">
          <SheetTitle className="flex flex-row items-center gap-2 text-base font-bold text-store-foreground">
            <ShoppingBag
              className="w-5 h-5 text-store-muted-foreground"
              aria-hidden="true"
            />
            <span>{t("cart")}</span>
            {itemCount > 0 && (
              <span className="rounded-full bg-store-primary-soft px-2 py-0.5 text-xs font-semibold text-store-primary tabular-nums">
                {itemCount}
              </span>
            )}
          </SheetTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeCart}
            aria-label={t("closeCart")}
          >
            <X className="w-5 h-5" />
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-store-surface">
          {loading ? (
            <div
              aria-hidden="true"
              className="animate-pulse space-y-4 p-4 motion-reduce:animate-none"
            >
              {[0, 1].map((row) => (
                <div key={row} className="flex gap-4">
                  <div className="size-16 shrink-0 rounded-store bg-store-surface-muted" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 w-3/4 rounded bg-store-surface-muted" />
                    <div className="h-3 w-1/2 rounded bg-store-surface-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <CartEmptyState
              basePath={basePath}
              density="drawer"
              onNavigate={closeCart}
            />
          ) : (
            <ul className="divide-y divide-store-border bg-store-surface px-4">
              {awjCart
                ? awjCart.items.map((line) => (
                    <li key={line.id}>
                      <CartLine
                        view={awjCartLineView(
                          line,
                          basePath,
                          line.productId ? images[line.productId] : null,
                        )}
                        density="drawer"
                        disabled={updating}
                        onNavigate={closeCart}
                        onQuantityChange={(quantity) =>
                          updateItem(line.id, quantity)
                        }
                        onRemove={() => removeItem(line.id)}
                      />
                    </li>
                  ))
                : (spreeCart?.items ?? []).map((line) => (
                    <li key={line.id}>
                      <CartLine
                        view={spreeCartLineView(line, basePath)}
                        density="drawer"
                        disabled={updating}
                        onNavigate={closeCart}
                        onQuantityChange={(quantity) =>
                          updateItem(line.id, quantity)
                        }
                        onRemove={async () => {
                          await removeItem(line.id);
                          if (spreeCart) {
                            trackRemoveFromCart(line, spreeCart.currency);
                          }
                        }}
                      />
                    </li>
                  ))}
            </ul>
          )}
        </div>

        {!isEmpty && !loading && (
          <SheetFooter className="gap-0 border-t border-store-border bg-store-surface p-0">
            {!expressProcessing && (
              <div className="space-y-3 border-b border-store-border p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-store-muted-foreground">
                    {tc("subtotal")}
                  </span>
                  <span className="text-base font-bold tabular-nums text-store-foreground">
                    <bdi>
                      {awjCart
                        ? formatMinorAmount(awjCart.subtotal)
                        : (spreeCart?.display_item_total ?? "")}
                    </bdi>
                  </span>
                </div>
                {spreeCart?.discount_total &&
                  parseFloat(spreeCart.discount_total) < 0 && (
                    <div className="flex items-center justify-between text-sm text-store-success">
                      <span>{tc("discount")}</span>
                      <span className="tabular-nums">
                        <bdi>{spreeCart.display_discount_total}</bdi>
                      </span>
                    </div>
                  )}
                <div className="flex items-center justify-between text-xs text-store-muted-foreground">
                  <span>{tc("shipping")}</span>
                  <span>{t("shippingCalculatedAtCheckout")}</span>
                </div>
                {awjCart && <CouponField className="pt-1" />}
              </div>
            )}

            {/* Express checkout must stay mounted while it processes. AWJ carts
                have no payment integration at all, so it never renders for one
                rather than being wired to state it cannot use. */}
            {spreeCart && parseFloat(spreeCart.total ?? "0") > 0 && (
              <div className="px-4 pt-4">
                <ExpressCheckoutButton
                  cart={spreeCart}
                  basePath={basePath}
                  onComplete={async () => {
                    await refreshCart();
                    closeCart();
                  }}
                  onProcessingChange={setExpressProcessing}
                />
              </div>
            )}

            {!expressProcessing && (
              <div className="space-y-2 p-4">
                <Button size="lg" className="w-full" asChild>
                  <Link
                    href={
                      awjCart
                        ? `${basePath}/checkout`
                        : `${basePath}/checkout/${spreeCart?.id}`
                    }
                    onClick={closeCart}
                  >
                    {t("checkout")}
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="w-full" asChild>
                  {/* Unchanged for both surfaces: the wholesale drawer has
                      always pointed here, and re-routing it is not this
                      slice's change to make. */}
                  <Link href={`${basePath}/cart`} onClick={closeCart}>
                    {t("viewCart")}
                  </Link>
                </Button>
              </div>
            )}
          </SheetFooter>
        )}

        {updating && (
          <div className="absolute inset-0 flex items-center justify-center bg-store-surface/60">
            <div className="size-8 animate-spin rounded-full border-4 border-store-primary border-t-transparent motion-reduce:animate-none" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Spree line → view. Spree serves its money already formatted
 * (`display_price`, `display_compare_at_amount`), so nothing is computed here
 * either — the wholesale surface's authority is simply a different one.
 */
function spreeCartLineView(line: LineItem, basePath: string): CartLineView {
  const onSale =
    line.compare_at_amount != null &&
    line.price != null &&
    parseFloat(line.compare_at_amount) > parseFloat(line.price);

  return {
    id: line.id,
    name: line.name,
    href: line.slug ? `${basePath}/products/${line.slug}` : null,
    imageUrl: line.thumbnail_url ?? null,
    meta: [line.options_text],
    quantity: line.quantity,
    available: true,
    unitPriceLabel: line.display_price ?? null,
    lineTotalLabel: line.display_price ?? null,
    compareAtLabel: onSale ? (line.display_compare_at_amount ?? null) : null,
  };
}
