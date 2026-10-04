"use client";

import { Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DeliveryPromiseView } from "@/lib/commerce/pdp-gifting";
import { formatDeliveryWindow } from "@/lib/utils/delivery-day";

/**
 * FLOWERS-H11 — the product's derived delivery promise (ADR-20). The backend
 * computes it from stock, the delivery schedule and preparation time; this only
 * words it. "Today" comes from the server's own `same_day` flag — the promise
 * carries no timezone, so the storefront never guesses "tomorrow" — and any
 * other date is shown as a plain calendar date. The actual date and window are
 * chosen (and re-checked) at checkout.
 */
export function DeliveryPromiseNote({
  promise,
}: {
  promise: DeliveryPromiseView;
}) {
  const t = useTranslations("products");
  const locale = useLocale();

  let message: string;
  if (!promise.deliverable || !promise.earliest) {
    message = t("deliveryPromiseNone");
  } else {
    const window = formatDeliveryWindow(
      promise.earliest.startTime,
      promise.earliest.endTime,
      locale,
    );
    if (!window) return null;
    if (promise.sameDay) {
      message = t("deliveryPromiseToday", { window });
    } else {
      const day = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${promise.earliest.date}T12:00:00Z`));
      message = t("deliveryPromiseEarliest", { day, window });
    }
  }

  const positive = promise.deliverable && promise.earliest !== null;
  return (
    <p
      data-delivery-promise={positive ? "available" : "unavailable"}
      className={
        positive
          ? "mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-store-primary"
          : "mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-store-muted-foreground"
      }
    >
      <Truck className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
