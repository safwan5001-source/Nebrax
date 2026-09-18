"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AccountOrderStatus } from "@/components/account/AccountOrderStatus";
import { awjOrderLineView, CartLine } from "@/components/cart/CartLine";
import { useCartLineImages } from "@/hooks/useCartLineImages";
import { localeDirection } from "@/i18n/locales";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import {
  AWJ_DELIVERY_METHODS,
  type StorefrontOrder,
} from "@/lib/commerce/checkout-types";

function formatOrderDate(value: string | null, locale: string) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(
  status: string,
  t: ReturnType<typeof useTranslations<"orders">>,
) {
  if (status === "confirmed") return t("statusConfirmed");
  if (status === "draft") return t("statusDraft");
  return status;
}

/**
 * Account order detail.
 *
 * Renders only authoritative `StorefrontOrder` fields from
 * `serializeOrder()`. It never presents the order as a tax document, never
 * offers a document download, never sums amounts locally, and never invents a
 * payment or fulfilment state. Payment is mentioned only as the honesty
 * note already used on confirmation: no payment was taken.
 */
export function AccountOrderDetail({
  order,
  basePath,
}: {
  order: StorefrontOrder;
  basePath: string;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const tawj = useTranslations("awjCheckout");
  const locale = useLocale();
  const rtl = localeDirection(locale) === "rtl";
  const BackChevron = rtl ? ChevronRight : ChevronLeft;
  const images = useCartLineImages(order.items.map((item) => item.productId));
  const placed = formatOrderDate(order.createdAt, locale);

  const address = [
    order.delivery.street,
    order.delivery.district,
    order.delivery.city,
    order.delivery.postal_code,
    order.delivery.country,
  ]
    .filter(Boolean)
    .join(locale === "ar" ? "، " : ", ");

  return (
    <div>
      <Link
        href={`${basePath}/account/orders`}
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-store-muted-foreground hover:text-store-foreground"
      >
        <BackChevron className="size-4" aria-hidden="true" />
        {t("backToOrders")}
      </Link>

      <header className="border-b border-store-border pb-4">
        <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
          {t("orderTitle", { number: order.number })}
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-store-muted-foreground">
          {placed && <span>{t("placedOn", { date: placed })}</span>}
          <span>{statusLabel(order.status, t)}</span>
        </p>
      </header>

      <div className="mt-4">
        <AccountOrderStatus status={order.status} />
      </div>

      <p
        role="status"
        className="mt-4 rounded-store border border-store-border bg-store-surface-muted p-4 text-sm leading-relaxed text-store-muted-foreground"
      >
        {tawj("success.notPaidNote")}
      </p>

      <section
        aria-labelledby="account-order-items"
        className="mt-4 rounded-store border border-store-border bg-store-surface"
      >
        <h2
          id="account-order-items"
          className="border-b border-store-border px-5 py-4 text-sm font-bold text-store-foreground"
        >
          {t("orderItems")}
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

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-store border border-store-border bg-store-surface p-5">
          <h2 className="text-xs font-semibold text-store-muted-foreground">
            {t("contact")}
          </h2>
          <div className="mt-2 space-y-0.5 text-sm text-store-foreground">
            {order.contact.name && <p>{order.contact.name}</p>}
            {order.contact.phone && (
              <p>
                <bdi>{order.contact.phone}</bdi>
              </p>
            )}
            {order.contact.email && (
              <p>
                <bdi>{order.contact.email}</bdi>
              </p>
            )}
          </div>
        </div>
        <div className="rounded-store border border-store-border bg-store-surface p-5">
          <h2 className="text-xs font-semibold text-store-muted-foreground">
            {t("deliveryAddress")}
          </h2>
          <div className="mt-2 space-y-0.5 text-sm text-store-foreground">
            {address && <p className="leading-relaxed">{address}</p>}
            {order.deliveryMethod && (
              <p className="text-store-muted-foreground">
                {AWJ_DELIVERY_METHODS.includes(
                  order.deliveryMethod as (typeof AWJ_DELIVERY_METHODS)[number],
                )
                  ? tawj(`delivery.methods.${order.deliveryMethod}`)
                  : order.deliveryMethod}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
