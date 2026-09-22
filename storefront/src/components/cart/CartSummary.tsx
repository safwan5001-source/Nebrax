"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CouponField } from "@/components/cart/CouponField";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { AwjMoney } from "@/lib/commerce/checkout-types";
import { cn } from "@/lib/utils";

/**
 * The order summary panel — the cart's and the checkout's single money surface.
 *
 * ## Why there is no "Total" row before the order exists
 *
 * The AWJ cart payload carries exactly one figure: `subtotal`. There is no
 * total, no tax and no discount in `CommerceCartService::serialize()`, and
 * `CommerceCheckoutService::serialize()` adds only `delivery.amount` — a real,
 * server-committed figure once a delivery method is saved
 * (`ShippingRateService`, COM-MOBILE-SHIPPING-1/ADR-10; `0` for `pickup` or a
 * tenant with no configured zone, never a placeholder).
 *
 * Adding those two numbers in the browser and labelling the result "Total"
 * would be a client-authoritative total: it would read as a promise the server
 * never made, and it would silently become wrong the day delivery pricing or
 * tax lands while this component kept summing two of the three figures. So the
 * subtotal is the panel's hero figure, the delivery row states its method
 * without inventing a price, and the panel says in one line that the final
 * amount is confirmed when the order is placed.
 *
 * The confirmation screen does show a total — `order.total`, which the server
 * computed and sent. That is the first point in the journey where a total
 * exists, and it is printed, not derived.
 */

interface SummaryRow {
  label: string;
  value: ReactNode;
  muted?: boolean;
}

interface CartSummaryProps {
  subtotal: AwjMoney;
  itemCount: number;
  /** The chosen delivery method's label; omitted on the cart, where none is chosen yet. */
  deliveryLabel?: string | null;
  /** Rendered under the figures — the checkout button, or whatever the surface's primary action is. */
  actions?: ReactNode;
  /** Line list rendered above the figures (the checkout's read-only item review). */
  children?: ReactNode;
  showCoupon?: boolean;
  className?: string;
  sticky?: boolean;
}

export function CartSummary({
  subtotal,
  itemCount,
  deliveryLabel,
  actions,
  children,
  showCoupon = true,
  className,
  sticky = false,
}: CartSummaryProps) {
  const t = useTranslations("cart");
  const tc = useTranslations("common");

  // Deliberately short: these are the only figures the server sends that are
  // not the subtotal itself, which is the panel's hero below. No tax row (the
  // API carries none — see `TAX_PRESENTATION_CAPABILITY`) and no discount row
  // (none either — see `COUPON_CAPABILITY`); a zero in either place would be a
  // monetary claim this storefront cannot source.
  const rows: SummaryRow[] = [
    {
      label: tc("shipping"),
      // `deliveryLabel` already carries the real formatted amount once the
      // caller (`AwjCheckoutFlow`) has a server-confirmed one to show.
      value: deliveryLabel ?? t("shippingCalculatedAtCheckout"),
      muted: true,
    },
  ];

  return (
    <aside
      aria-labelledby="cart-summary-heading"
      className={cn(
        "rounded-store border border-store-border bg-store-surface",
        sticky && "lg:sticky lg:top-24",
        className,
      )}
    >
      <div className="flex items-baseline justify-between border-b border-store-border px-5 py-4">
        <h2
          id="cart-summary-heading"
          className="text-sm font-bold text-store-foreground"
        >
          {tc("orderSummary")}
        </h2>
        <span className="text-xs text-store-muted-foreground tabular-nums">
          {t("itemCount", { count: itemCount })}
        </span>
      </div>

      {children && (
        <div className="max-h-72 overflow-y-auto border-b border-store-border px-5">
          {children}
        </div>
      )}

      <dl className="space-y-3 px-5 py-4 text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4"
          >
            <dt className="text-store-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                "text-end",
                row.muted
                  ? "text-xs text-store-muted-foreground"
                  : "font-semibold tabular-nums text-store-foreground",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-store-border px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-bold text-store-foreground">
            {tc("subtotal")}
          </span>
          <span className="text-xl font-bold tabular-nums text-store-foreground">
            <bdi>{formatMinorAmount(subtotal)}</bdi>
          </span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-store-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("summary.totalConfirmedOnPlacement")}</span>
        </p>
      </div>

      {showCoupon && (
        <div className="border-t border-store-border px-5 py-4">
          <CouponField />
        </div>
      )}

      {actions && (
        <div className="border-t border-store-border px-5 py-4">{actions}</div>
      )}
    </aside>
  );
}
