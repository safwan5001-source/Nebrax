"use client";

import { ChevronLeft, ChevronRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { localeDirection } from "@/i18n/locales";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";

function formatOrderDate(value: string | null, locale: string) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
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

export function AccountOrderList({
  orders,
  basePath,
  lookupUnavailable,
}: {
  orders: StorefrontOrder[];
  basePath: string;
  lookupUnavailable?: boolean;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const rtl = localeDirection(locale) === "rtl";
  const Chevron = rtl ? ChevronLeft : ChevronRight;

  return (
    <div>
      <h1 className="text-xl font-bold text-store-foreground">
        {t("orderHistory")}
      </h1>

      {lookupUnavailable && (
        <div className="mt-2">
          <AccountGatedNotice
            title={t("lookupUnavailableTitle")}
            body={t("lookupUnavailableBody")}
          />
        </div>
      )}

      {orders.length === 0 ? (
        <div className="mt-5">
          <AccountEmptyState
            icon={ShoppingBag}
            title={t("noOrders")}
            description={t("noOrdersDescription")}
            actionHref={`${basePath}/products`}
            actionLabel={t("startShopping")}
          />
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-store-border overflow-hidden rounded-store border border-store-border bg-store-surface">
          {orders.map((order) => {
            const date = formatOrderDate(order.createdAt, locale);
            return (
              <li key={order.id}>
                <Link
                  href={`${basePath}/account/orders/${order.id}`}
                  className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-store-surface-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-store-foreground">
                      <bdi>{order.number}</bdi>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-store-muted-foreground">
                      {date && <span>{date}</span>}
                      <span>{statusLabel(order.status, t)}</span>
                      <span>
                        {t("itemCount", { count: order.items.length })}
                      </span>
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-store-foreground">
                    <bdi>{formatMinorAmount(order.total)}</bdi>
                  </p>
                  <Chevron
                    className="size-4 shrink-0 text-store-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
