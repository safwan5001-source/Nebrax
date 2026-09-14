"use client";

import type { LineItem } from "@spree/sdk";
import { ShoppingBag } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { QuantityPickerField } from "@/components/cart/QuantityPickerField";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import { useCart } from "@/contexts/CartContext";
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

export default function CartPage() {
  const { cart, loading, updating, updateItem, removeItem } = useCart();
  const [expressProcessing, setExpressProcessing] = useState(false);
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const viewCartFiredRef = useRef(false);
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  const isAwj = isStorefrontCart(cart);

  // Track view_cart when cart loads with items. AWJ carts don't fire this
  // yet — see CartDrawer's identical note (GA4's view_cart payload wants
  // Spree's Cart/Order shape; adapting analytics is a deferred, separate
  // concern from wiring the cart data itself).
  useEffect(() => {
    if (
      !loading &&
      cart &&
      !isAwj &&
      cart.total_quantity > 0 &&
      !viewCartFiredRef.current
    ) {
      trackViewCart(cart);
      viewCartFiredRef.current = true;
    }
  }, [cart, loading, isAwj]);

  const handleRemoveSpreeLine = async (item: LineItem) => {
    await removeItem(item.id);
    if (cart && !isAwj) {
      trackRemoveFromCart(item, cart.currency);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8  py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-32 mb-8"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!cart?.items || cart.items.length === 0) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8  py-16">
        <div className="text-center">
          <ShoppingBag
            className="w-24 h-24 text-gray-300 mx-auto"
            strokeWidth={1}
          />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            {t("emptyCart")}
          </h1>
          <p className="mt-2 text-gray-500">{t("emptyCartDescription")}</p>
          <div className="mt-6">
            <Button size="lg" asChild>
              <Link href={`${basePath}/products`}>
                {tc("continueShopping")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8  py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        {t("shoppingCart")}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 divide-y">
            {cart.items.map((item) => {
              if (isAwj) {
                const line = item as StorefrontCartLine;
                return (
                  <div key={line.id} className="p-6 flex gap-6">
                    <div className="relative w-24 h-24 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
                      <ProductImage
                        src={null}
                        alt={line.name}
                        fill
                        className="object-cover"
                        sizes="96px"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3
                        className={`text-lg font-medium truncate ${line.available ? "text-gray-900" : "text-gray-400"}`}
                      >
                        {line.name}
                      </h3>
                      {!line.available && (
                        <p className="mt-1 text-sm text-red-600">
                          {t("itemUnavailable")}
                        </p>
                      )}
                      <p className="mt-2 text-lg font-semibold text-gray-900">
                        {formatMinorAmount(line.unitPrice)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <QuantityPickerField
                        quantity={line.quantity}
                        onQuantityChange={(quantity) =>
                          updateItem(line.id, quantity)
                        }
                        disabled={updating || !line.available}
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        aria-label={t("removeItemLabel", { name: line.name })}
                        onClick={() => removeItem(line.id)}
                        disabled={updating}
                      >
                        {tc("remove")}
                      </Button>
                    </div>
                  </div>
                );
              }

              const line = item as LineItem;
              return (
                <div key={line.id} className="p-6 flex gap-6">
                  {/* Image */}
                  <div className="relative w-24 h-24 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
                    <ProductImage
                      src={line.thumbnail_url}
                      alt={line.name}
                      fill
                      className="object-cover"
                      sizes="96px"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-gray-900 truncate">
                      {line.name}
                    </h3>
                    {line.options_text && (
                      <p className="mt-1 text-sm text-gray-500">
                        {line.options_text}
                      </p>
                    )}
                    <p className="mt-2 text-lg font-semibold text-gray-900">
                      {line.display_price}
                    </p>
                  </div>

                  {/* Quantity & Actions */}
                  <div className="flex flex-col items-end gap-2">
                    <QuantityPickerField
                      quantity={line.quantity}
                      onQuantityChange={(quantity) =>
                        updateItem(line.id, quantity)
                      }
                      disabled={updating}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={t("removeItemLabel", { name: line.name })}
                      onClick={() => handleRemoveSpreeLine(line)}
                      disabled={updating}
                    >
                      {tc("remove")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-6 sticky top-24">
            <h2 className="text-lg font-medium text-gray-900">
              {tc("orderSummary")}
            </h2>

            {isAwj ? (
              <dl className="mt-6 space-y-4">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{tc("subtotal")}</dt>
                  <dd className="text-gray-900">
                    {formatMinorAmount(cart.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{tc("shipping")}</dt>
                  <dd className="text-gray-500">
                    {t("shippingCalculatedAtCheckout")}
                  </dd>
                </div>
                <div className="border-t pt-4 flex justify-between">
                  <dt className="text-lg font-medium text-gray-900">
                    {tc("total")}
                  </dt>
                  <dd className="text-lg font-bold text-gray-900">
                    {formatMinorAmount(cart.subtotal)}
                  </dd>
                </div>
              </dl>
            ) : (
              <dl className="mt-6 space-y-4">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{tc("subtotal")}</dt>
                  <dd className="text-gray-900">{cart.display_item_total}</dd>
                </div>
                {cart.discount_total && parseFloat(cart.discount_total) < 0 && (
                  <div className="flex justify-between text-green-600">
                    <dt>{tc("discount")}</dt>
                    <dd>{cart.display_discount_total}</dd>
                  </div>
                )}
                {cart.delivery_total && parseFloat(cart.delivery_total) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{tc("shipping")}</dt>
                    <dd className="text-gray-900">
                      {cart.display_delivery_total}
                    </dd>
                  </div>
                )}
                {cart.tax_total && parseFloat(cart.tax_total) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{tc("tax")}</dt>
                    <dd className="text-gray-900">{cart.display_tax_total}</dd>
                  </div>
                )}
                <div className="border-t pt-4 flex justify-between">
                  <dt className="text-lg font-medium text-gray-900">
                    {tc("total")}
                  </dt>
                  <dd className="text-lg font-bold text-gray-900">
                    {cart.display_total}
                  </dd>
                </div>

                {cart.gift_card &&
                parseFloat(cart.gift_card_total ?? "0") > 0 ? (
                  <div className="flex justify-between text-green-600">
                    <dt>{t("giftCard")}</dt>
                    <dd>-{cart.display_gift_card_total}</dd>
                  </div>
                ) : cart.store_credit_total &&
                  parseFloat(cart.store_credit_total) > 0 ? (
                  <div className="flex justify-between text-green-600">
                    <dt>{t("storeCredit")}</dt>
                    <dd>-{cart.display_store_credit_total}</dd>
                  </div>
                ) : null}

                {cart.amount_due &&
                  cart.amount_due !== cart.total &&
                  parseFloat(cart.amount_due) > 0 && (
                    <div className="border-t pt-4 flex justify-between">
                      <dt className="text-lg font-medium text-gray-900">
                        {t("amountDue")}
                      </dt>
                      <dd className="text-lg font-bold text-gray-900">
                        {cart.display_amount_due}
                      </dd>
                    </div>
                  )}
              </dl>
            )}

            <div className="mt-6 space-y-3">
              {/* AWJ carts have no checkout yet (no client-visible cart id
                  at all) and no Payments integration — neither renders for
                  an AWJ cart, matching CartDrawer's identical boundary. */}
              {!isAwj && parseFloat(cart.total ?? "0") > 0 && (
                <ExpressCheckoutButton
                  cart={cart}
                  basePath={basePath}
                  onComplete={() => {}}
                  onProcessingChange={setExpressProcessing}
                />
              )}
              {!expressProcessing && !isAwj && (
                <>
                  <Button size="lg" asChild className="w-full">
                    <Link href={`${basePath}/checkout/${cart.id}`}>
                      {t("proceedToCheckout")}
                    </Link>
                  </Button>
                  <Button variant="link" asChild className="w-full">
                    <Link href={`${basePath}/products`}>
                      {tc("continueShopping")}
                    </Link>
                  </Button>
                </>
              )}
              {isAwj && (
                <Button variant="link" asChild className="w-full">
                  <Link href={`${basePath}/products`}>
                    {tc("continueShopping")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
