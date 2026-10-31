"use client";

import { ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { CartEmptyState } from "@/components/cart/CartEmptyState";
import { awjCartLineView, CartLine } from "@/components/cart/CartLine";
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
import { formatMinorAmount, lineGroups } from "@/lib/commerce/cart-types";
import { extractBasePath } from "@/lib/utils/path";

/**
 * The cart quick-access surface.
 *
 * Mounted under the root layout's `<CartProvider>`, whose cart is the AWJ-native
 * `StorefrontCart` (DTC and the native wholesale buyer share it).
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
    accessIssue,
  } = useCart();
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  // The drawer always enters from the "end" edge — left in Arabic, right in
  // English — matching where the header's cart button sits.
  const drawerSide = localeDirection(useLocale()) === "rtl" ? "left" : "right";
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      closeCart();
    }
  }, [pathname, closeCart]);

  // Only fetched while the drawer is actually open — a closed drawer requests
  // no imagery.
  const images = useCartLineImages(
    cart?.items.map((line) => line.productId) ?? [],
    isOpen,
  );

  const isEmpty = (cart?.items?.length ?? 0) === 0;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeCart();
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
              accessIssue={accessIssue}
            />
          ) : (
            <ul className="divide-y divide-store-border bg-store-surface px-4">
              {lineGroups(cart?.items ?? [], {
                id: (line) => line.id,
                parent: (line) => line.addonOf,
              }).map(({ line, addons }) => (
                <li key={line.id}>
                  {[line, ...addons].map((row) => (
                    <CartLine
                      key={row.id}
                      view={awjCartLineView(
                        row,
                        basePath,
                        row.productId ? images[row.productId] : null,
                      )}
                      density="drawer"
                      disabled={updating}
                      onNavigate={closeCart}
                      onQuantityChange={(quantity) =>
                        updateItem(row.id, quantity)
                      }
                      onRemove={() => removeItem(row.id)}
                    />
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!isEmpty && !loading && (
          <SheetFooter className="gap-0 border-t border-store-border bg-store-surface p-0">
            <div className="space-y-3 border-b border-store-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-store-muted-foreground">
                  {tc("subtotal")}
                </span>
                <span className="text-base font-bold tabular-nums text-store-foreground">
                  <bdi>{cart ? formatMinorAmount(cart.subtotal) : ""}</bdi>
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-store-muted-foreground">
                <span>{tc("shipping")}</span>
                <span>{t("shippingCalculatedAtCheckout")}</span>
              </div>
              <CouponField className="pt-1" />
            </div>

            <div className="space-y-2 p-4">
              <Button size="lg" className="w-full" asChild>
                <Link href={`${basePath}/checkout`} onClick={closeCart}>
                  {t("checkout")}
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full" asChild>
                <Link href={`${basePath}/cart`} onClick={closeCart}>
                  {t("viewCart")}
                </Link>
              </Button>
            </div>
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
