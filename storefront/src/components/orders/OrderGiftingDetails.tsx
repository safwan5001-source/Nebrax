"use client";

import { useLocale, useTranslations } from "next-intl";
import type { StorefrontOrder } from "@/lib/commerce/checkout-types";
import {
  formatDeliveryWindow,
  formatPlainDate,
} from "@/lib/utils/delivery-day";

/**
 * The requested delivery date/window and the gift card of a placed order
 * (FLOWERS-H12 / H13).
 *
 * One component for the confirmation screen and the account order detail, so
 * the two never describe the same order differently. Both fields are the
 * immutable snapshots the server stored at completion (ADR-15 / ADR-19): this
 * renders them as they are and never re-derives a date, a status or a promise.
 * The date is a plain calendar date — the stored order carries no timezone, so
 * nothing here says "today" or "tomorrow". Renders nothing for an order that
 * has neither, so a non-gifting store's order looks exactly as before.
 */
export function OrderGiftingDetails({
  order,
  className = "mt-4",
}: {
  order: StorefrontOrder;
  className?: string;
}) {
  const t = useTranslations("awjCheckout");
  const locale = useLocale();
  const { schedule, gift } = order;
  if (!schedule && !gift) return null;

  const window = schedule
    ? formatDeliveryWindow(
        schedule.slot.startTime,
        schedule.slot.endTime,
        locale,
      )
    : null;

  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${className}`}
      data-order-gifting
    >
      {schedule && (
        <DetailCard title={t("success.scheduleHeading")}>
          <p>{formatPlainDate(schedule.date, locale)}</p>
          <p className="mt-1 text-store-muted-foreground">
            {locale.toLowerCase().startsWith("en") && schedule.slot.labelEn
              ? schedule.slot.labelEn
              : schedule.slot.label}
            {window ? <bdi className="ms-2">{window}</bdi> : null}
          </p>
        </DetailCard>
      )}
      {gift && (
        <DetailCard title={t("success.giftHeading")}>
          <p>
            {t("review.giftTo")}: {gift.recipientName}
            {gift.recipientPhone ? (
              <span className="ms-2">
                <bdi dir="ltr">{gift.recipientPhone}</bdi>
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-store-muted-foreground">
            {t("review.giftFrom")}:{" "}
            {gift.hideSender
              ? t("review.giftAnonymous")
              : (gift.senderDisplayName ?? "—")}
          </p>
          {gift.message ? (
            <p className="mt-1 whitespace-pre-line text-store-muted-foreground">
              {gift.message}
            </p>
          ) : null}
        </DetailCard>
      )}
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
