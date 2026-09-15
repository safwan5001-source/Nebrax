"use client";

import type { LineItem } from "@spree/sdk";
import { ShoppingBag, Trash, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { QuantityPickerField } from "@/components/cart/QuantityPickerField";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCart } from "@/contexts/CartContext";
import { localeDirection } from "@/i18n/locales";
import { trackRemoveFromCart, trackViewCart } from "@/lib/analytics/gtm";
import {
  formatMinorAmount,
  isStorefrontCart,
  type StorefrontCartLine,
} from "@/lib/commerce/cart-types";
import { extractBasePath } from "@/lib/utils/path";

const ExpressCheckoutButton = dynamic(
  () =>
    import("@/components/checkout/ExpressCheckoutButton").then((m) => ({
      default: m.ExpressCheckoutButton,
    })),
  { ssr: false },
);

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
  // السلة تُفتَح دائماً من حافة «النهاية» — يساراً في العربية، يميناً في
  // الإنجليزية — مطابقةً لموضع أيقونة السلة المعتاد في الترويسة.
  const drawerSide = localeDirection(useLocale()) === "rtl" ? "left" : "right";
  const [expressProcessing, setExpressProcessing] = useState(false);
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const viewCartFiredRef = useRef(false);
  const prevPathnameRef = useRef(pathname);

  // Close when navigating
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      closeCart();
      setExpressProcessing(false);
    }
  }, [pathname, closeCart]);

  const isAwj = isStorefrontCart(cart);

  // Track view_cart when drawer opens with items (fire once per open).
  // AWJ carts don't fire this yet — GA4's view_cart payload wants Spree's
  // Cart/Order shape (discounts, item_total); adapting analytics is a
  // deferred, separate concern from wiring the cart data itself.
  useEffect(() => {
    if (
      isOpen &&
      cart &&
      !isAwj &&
      cart.total_quantity > 0 &&
      !viewCartFiredRef.current
    ) {
      trackViewCart(cart);
      viewCartFiredRef.current = true;
    }
    if (!isOpen) {
      viewCartFiredRef.current = false;
    }
  }, [isOpen, cart, isAwj]);

  const lineItems = cart?.items || [];
  const isEmpty = lineItems.length === 0;

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
        className="w-full sm:max-w-md flex flex-col p-0 gap-0"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <SheetHeader className="flex flex-row gap-2 items-center justify-between border-b">
          <SheetTitle className="flex flex-row gap-2 items-center">
            <ShoppingBag className="w-6 h-6 text-gray-600" />
            <span>{t("cart")}</span>
            {itemCount > 0 && (
              <span className="text-gray-600">
                {t("itemCount", { count: itemCount })}
              </span>
            )}
          </SheetTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeCart}
            aria-label={t("closeCart")}
          >
            <X className="w-6 h-6" />
          </Button>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex gap-4 animate-pulse">
                  <div className="w-24 h-24 bg-gray-200 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <ShoppingBag
                className="w-16 h-16 text-gray-300 mb-4"
                strokeWidth={1}
              />
              <p className="text-gray-500 mb-4">{t("emptyCart")}</p>
              <Link
                href={`${basePath}/products`}
                className="text-primary hover:text-primary font-medium"
                onClick={closeCart}
              >
                {tc("continueShopping")}
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {lineItems.map((item) => {
                if (isAwj) {
                  const line = item as StorefrontCartLine;
                  return (
                    <li key={line.id} className="p-4">
                      <div className="flex gap-4">
                        {/* AWJ cart lines carry no image — the catalog's is
                            not re-fetched per line to keep this a narrow
                            cart wiring, not a new cart-enrichment feature. */}
                        <div className="relative w-24 h-24 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                          <ProductImage
                            src={null}
                            alt={line.name}
                            fill
                            className="object-cover"
                            sizes="96px"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <span
                              className={`font-medium line-clamp-2 ${line.available ? "text-gray-900" : "text-gray-400"}`}
                            >
                              {line.name}
                            </span>
                            <Button
                              variant="destructive"
                              size="icon-xs"
                              onClick={() => removeItem(line.id)}
                              disabled={updating}
                              aria-label={t("removeItemLabel", {
                                name: line.name,
                              })}
                            >
                              <Trash className="w-4 h-4" />
                            </Button>
                          </div>

                          {!line.available && (
                            <p className="mt-1 text-sm text-red-600">
                              {t("itemUnavailable")}
                            </p>
                          )}

                          <div className="mt-3 flex items-center justify-between">
                            <QuantityPickerField
                              quantity={line.quantity}
                              onQuantityChange={(quantity) =>
                                updateItem(line.id, quantity)
                              }
                              disabled={updating || !line.available}
                            />
                            <span className="text-sm font-medium text-gray-900">
                              {formatMinorAmount(line.unitPrice)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                }

                const line = item as LineItem;
                return (
                  <li key={line.id} className="p-4">
                    <div className="flex gap-4">
                      {/* Image */}
                      <Link
                        href={`${basePath}/products/${line.slug}`}
                        className="relative w-24 h-24 bg-gray-100 rounded overflow-hidden flex-shrink-0"
                        onClick={closeCart}
                      >
                        <ProductImage
                          src={line.thumbnail_url}
                          alt={line.name}
                          fill
                          className="object-cover"
                          sizes="96px"
                        />
                      </Link>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <Link
                            href={`${basePath}/products/${line.slug}`}
                            className="font-medium text-gray-900 hover:text-primary line-clamp-2"
                            onClick={closeCart}
                          >
                            {line.name}
                          </Link>
                          <Button
                            variant="destructive"
                            size="icon-xs"
                            onClick={async () => {
                              await removeItem(line.id);
                              if (cart && !isAwj) {
                                trackRemoveFromCart(line, cart.currency);
                              }
                            }}
                            disabled={updating}
                            aria-label={t("removeItemLabel", {
                              name: line.name,
                            })}
                          >
                            <Trash className="w-4 h-4" />
                          </Button>
                        </div>

                        {/* Options */}
                        {line.options_text && (
                          <p className="mt-1 text-sm text-gray-500">
                            {line.options_text}
                          </p>
                        )}

                        {/* Quantity & Price */}
                        <div className="mt-3 flex items-center justify-between">
                          <QuantityPickerField
                            quantity={line.quantity}
                            onQuantityChange={(quantity) =>
                              updateItem(line.id, quantity)
                            }
                            disabled={updating}
                          />

                          <div className="text-sm font-medium">
                            {line.compare_at_amount &&
                            line.price != null &&
                            parseFloat(line.compare_at_amount) >
                              parseFloat(line.price) ? (
                              <>
                                <span className="text-gray-400 line-through me-2">
                                  {line.display_compare_at_amount}
                                </span>
                                <span className="text-red-600">
                                  {line.display_price}
                                </span>
                              </>
                            ) : (
                              <span className="text-gray-900">
                                {line.display_price}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {!isEmpty && !loading && (
          <SheetFooter className="border-t border-gray-200 p-4 space-y-4">
            {!expressProcessing && (
              <>
                {/* Summary */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>{tc("subtotal")}</span>
                    <span>
                      {isAwj
                        ? formatMinorAmount(cart.subtotal)
                        : cart?.display_item_total}
                    </span>
                  </div>
                  {!isAwj &&
                    cart?.discount_total &&
                    parseFloat(cart.discount_total) < 0 && (
                      <div className="flex justify-between items-center text-sm text-green-600">
                        <span>{tc("discount")}</span>
                        <span>{cart.display_discount_total}</span>
                      </div>
                    )}
                  <div className="flex justify-between items-center">
                    <span>{tc("shipping")}</span>
                    <span className="text-gray-500">
                      {t("shippingCalculatedAtCheckout")}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Express Checkout — must stay mounted during processing.
                AWJ carts have no checkout yet (no client-visible cart id
                at all — see StorefrontCart's own doc comment) and no
                Payments integration; this deliberately never renders for
                an AWJ cart rather than wiring it to state it can't use. */}
            {!isAwj && cart && parseFloat(cart.total ?? "0") > 0 && (
              <ExpressCheckoutButton
                cart={cart}
                basePath={basePath}
                onComplete={async () => {
                  await refreshCart();
                  closeCart();
                }}
                onProcessingChange={setExpressProcessing}
              />
            )}

            {!expressProcessing && !isAwj && (
              <div className="space-y-2">
                <Button size="lg" className="w-full" asChild>
                  <Link
                    href={`${basePath}/checkout/${cart?.id}`}
                    onClick={closeCart}
                  >
                    {t("checkout")}
                  </Link>
                </Button>
                <Button size="lg" className="w-full" variant="link" asChild>
                  <Link href={`${basePath}/cart`} onClick={closeCart}>
                    {t("viewCart")}
                  </Link>
                </Button>
              </div>
            )}
            {!expressProcessing && isAwj && (
              <div className="space-y-2">
                <Button size="lg" className="w-full" asChild>
                  <Link href={`${basePath}/checkout`} onClick={closeCart}>
                    {t("checkout")}
                  </Link>
                </Button>
                <Button size="lg" className="w-full" variant="link" asChild>
                  <Link href={`${basePath}/cart`} onClick={closeCart}>
                    {t("viewCart")}
                  </Link>
                </Button>
              </div>
            )}
          </SheetFooter>
        )}

        {/* Loading overlay */}
        {updating && (
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-gray-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
