"use client";

import { CheckCircle2, Info, Printer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { awjOrderLineView, CartLine } from "@/components/cart/CartLine";
import { Button } from "@/components/ui/button";
import { useCartLineImages } from "@/hooks/useCartLineImages";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";

/**
 * Stage 6 — order confirmation.
 *
 * This is the first and only place in the journey that shows a **total**, and
 * it shows the server's: `order.total`, computed by
 * `CommerceOrderService::createFromCheckout()` as the sum of the order's own
 * stored line totals. Nothing here adds anything up.
 *
 * It states what the order's `confirmed` status actually means. The AWJ order
 * is a commercial commitment; no payment was taken, because no payment
 * capability exists (`PAYMENT_CAPABILITY`). Saying "thank you for your payment"
 * on this screen would be the single most damaging untruth this storefront
 * could tell, so the note is not optional chrome — it is the screen's subject.
 *
 * What it deliberately does not offer: an order-tracking link, a delivery date,
 * a shipment status, or a receipt/invoice download. `CommerceOrder != Invoice`
 * (ADR-01), there is no order-lookup route for a guest, and no fulfilment
 * status exists to track. Each would be a promise with nothing behind it.
 */
export function AwjOrderConfirmation({
  order,
  basePath,
}: {
  order: StorefrontOrder;
  basePath: string;
}) {
  const t = useTranslations("awjCheckout");
  const tc = useTranslations("common");
  const images = useCartLineImages(order.items.map((item) => item.productId));

  const address = [
    order.delivery.street,
    order.delivery.district,
    order.delivery.city,
    order.delivery.postal_code,
    order.delivery.country,
  ]
    .filter(Boolean)
    .join("، ");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-store-success/10 text-store-success"
        >
          <CheckCircle2 className="w-8 h-8" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-store-foreground">
          {t("success.heading")}
        </h1>
        <p className="mt-2 text-sm text-store-muted-foreground">
          {t("success.orderNumberLabel")}
        </p>
        <p className="mt-1 text-lg font-bold tabular-nums text-store-foreground">
          <bdi>{order.number}</bdi>
        </p>
      </div>

      {/* Not a footnote. See this module's doc comment. */}
      <p
        role="status"
        className="mt-6 flex items-start gap-2 rounded-store border border-store-warning/40 bg-store-warning/10 p-4 text-sm leading-relaxed text-store-foreground"
      >
        <Info
          className="mt-0.5 w-4 h-4 shrink-0 text-store-warning"
          aria-hidden="true"
        />
        <span>{t("success.notPaidNote")}</span>
      </p>

      <section
        aria-labelledby="awj-confirmation-items"
        className="mt-6 rounded-store border border-store-border bg-store-surface"
      >
        <h2
          id="awj-confirmation-items"
          className="border-b border-store-border px-5 py-4 text-sm font-bold text-store-foreground"
        >
          {tc("orderSummary")}
        </h2>
        <ul className="divide-y divide-store-border px-5">
          {order.items.map((item, index) => (
            <li key={`${item.productId ?? "item"}-${index}`}>
              <CartLine
                view={awjOrderLineView(
                  item,
                  index,
                  basePath,
                  item.productId ? images[item.productId] : null,
                )}
                density="summary"
              />
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-store-border px-5 py-4">
          <span className="text-sm font-bold text-store-foreground">
            {tc("total")}
          </span>
          <span className="text-xl font-bold tabular-nums text-store-foreground">
            <bdi>{formatMinorAmount(order.total)}</bdi>
          </span>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailCard title={t("contact.heading")}>
          <p>{order.contact.name}</p>
          <p>
            <bdi>{order.contact.phone}</bdi>
          </p>
          {order.contact.email && (
            <p>
              <bdi>{order.contact.email}</bdi>
            </p>
          )}
        </DetailCard>
        <DetailCard title={t("address.heading")}>
          <p className="leading-relaxed">{address}</p>
          {order.deliveryMethod && (
            <p className="mt-1 text-store-muted-foreground">
              {t(`delivery.methods.${order.deliveryMethod}`)}
            </p>
          )}
        </DetailCard>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild size="lg">
          <Link href={`${basePath}/products`}>{tc("continueShopping")}</Link>
        </Button>
        {/* Printing the page is the only "keep a copy" this storefront can
            honestly offer: there is no invoice document and no guest order
            lookup to link to. */}
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => window.print()}
        >
          <Printer className="w-4 h-4" aria-hidden="true" />
          {t("success.print")}
        </Button>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-store border border-store-border bg-store-surface p-5">
      <h3 className="text-xs font-semibold text-store-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-0.5 text-sm text-store-foreground">
        {children}
      </div>
    </div>
  );
}
