"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOrdering } from "@/contexts/OrderingContext";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import { isolateBidi, minimumOrderView } from "@/lib/commerce/ordering";
import { cn } from "@/lib/utils";

/**
 * COPS-H4 Buyer Ordering UX — the cart/checkout-side explanation of the store's intake rules: the minimum order, how much
 * is still missing, and (when the store is not taking orders) what that means for this basket.
 *
 * **Advisory, never a gate.** It never disables the checkout action: the server's Checkout is the single source of truth
 * and refuses before writing anything (and its refusal for a minimum carries the exact `shortfall_minor`, which the
 * checkout flow prints). The figure shown here is the cart `subtotal` measured against the published minimum — the same
 * sum the server uses while the cart payload carries no discount — and the footnote says the final check happens when the
 * order is placed.
 *
 * Renders nothing when the block is absent (gate closed) or there is nothing to say, so the cart and checkout summary stay
 * byte-identical to before.
 */

interface OrderingCartNoticeProps {
  /** The cart/checkout subtotal in minor units, with its currency (the minimum is in the same currency). */
  subtotal: { amount_minor: number; currency: string };
  /**
   * The chosen delivery method, when known (Checkout). A `delivery_only` minimum does not apply to `pickup`; on the cart
   * the method is unknown, so the minimum is shown with its scope instead of being assumed to apply.
   */
  deliveryMethod?: string | null;
  className?: string;
}

export function OrderingCartNotice({
  subtotal,
  deliveryMethod = null,
  className,
}: OrderingCartNoticeProps) {
  const ordering = useOrdering();
  const t = useTranslations("ordering");
  if (!ordering) return null;

  const view = minimumOrderView(
    ordering,
    subtotal.amount_minor,
    deliveryMethod,
  );
  if (ordering.accepting && !view) return null;

  const money = (amountMinor: number) =>
    isolateBidi(
      formatMinorAmount({
        amount_minor: amountMinor,
        currency: subtotal.currency,
      }),
    );
  const deliveryOnly = view?.scope === "delivery_only";

  return (
    <div
      data-ordering-cart-notice=""
      className={cn(
        "space-y-2 rounded-store border border-store-border bg-store-surface-muted p-3 text-sm leading-relaxed",
        className,
      )}
    >
      {!ordering.accepting ? (
        <p className="flex items-start gap-2 text-store-foreground">
          <Info
            className="mt-0.5 size-4 shrink-0 text-store-warning"
            aria-hidden="true"
          />
          <span>{t("cart.notAccepting")}</span>
        </p>
      ) : null}

      {view ? (
        <div className="space-y-1">
          <p className="text-store-foreground">
            {deliveryOnly
              ? t("cart.minimumDeliveryOnly", {
                  amount: money(view.minOrderMinor),
                })
              : t("cart.minimum", { amount: money(view.minOrderMinor) })}
          </p>

          {!view.applies ? (
            <p className="text-store-muted-foreground">
              {t("cart.pickupExempt")}
            </p>
          ) : (
            // Polite live region: the shortfall changes as the shopper edits quantities, and that change is the news.
            <p
              aria-live="polite"
              data-ordering-shortfall={view.shortfallMinor ?? 0}
              className={cn(
                view.shortfallMinor !== null
                  ? "font-semibold text-store-foreground"
                  : "text-store-muted-foreground",
              )}
            >
              {view.shortfallMinor !== null
                ? t("cart.shortfall", { amount: money(view.shortfallMinor) })
                : t("cart.reached")}
            </p>
          )}

          {view.applies ? (
            <p className="text-xs text-store-muted-foreground">
              {t("cart.confirmedAtCheckout")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
