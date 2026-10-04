"use client";

import { Pencil, ShieldAlert } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import type { CheckoutStage } from "@/components/checkout/awj/types";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontCheckout } from "@/lib/commerce/checkout-types";
import {
  formatDeliveryWindow,
  formatPlainDate,
} from "@/lib/utils/delivery-day";

/**
 * Stage 5 — review and place the order.
 *
 * Everything shown here is read back from the `StorefrontCheckout` the server
 * last returned, never from the draft forms the shopper typed into. That is the
 * point of the stage: it is the shopper confirming what the server holds, so a
 * field that failed to save shows as missing here rather than as saved.
 *
 * Money is not summarised on this stage — the order summary panel beside it
 * owns that, and it does not compute a total (see `CartSummary`'s doc).
 *
 * The note above the button says exactly what pressing it does: it records a
 * commercial commitment, and no online/card payment is taken, because none
 * can be (`PAYMENT_CAPABILITY`). COD/Pay on Pickup (COM-MOBILE-PAYMENTS-1)
 * are a different thing entirely: real, and settled later in cash — this
 * row shows the real method chosen, if any.
 */
export function ReviewStage({
  checkout,
  stages,
  onEdit,
  t,
}: {
  checkout: StorefrontCheckout;
  /** The stages this checkout has — scheduling and gifting rows only appear when offered. */
  stages: readonly CheckoutStage[];
  onEdit: (stage: CheckoutStage) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale();
  const address = checkout.delivery.address;
  const addressLine = [
    address.street,
    address.district,
    address.city,
    address.region,
    address.postal_code,
    address.country,
  ]
    .filter(Boolean)
    .join("، ");

  const method = checkout.delivery.method;

  return (
    <StageShell
      id="awj-checkout-review"
      title={t("review.heading")}
      description={t("review.description")}
    >
      <dl className="divide-y divide-store-border">
        <ReviewRow
          label={t("contact.heading")}
          onEdit={() => onEdit("contact")}
          editLabel={t("review.editContact")}
          t={t}
        >
          <span className="block">{checkout.contact.name}</span>
          <span className="block" dir="ltr">
            <bdi>{checkout.contact.phone}</bdi>
          </span>
          {checkout.contact.email && (
            <span className="block">
              <bdi>{checkout.contact.email}</bdi>
            </span>
          )}
        </ReviewRow>

        <ReviewRow
          label={t("address.heading")}
          onEdit={() => onEdit("address")}
          editLabel={t("review.editAddress")}
          t={t}
        >
          <span className="block leading-relaxed">{addressLine}</span>
          {address.notes && (
            <span className="mt-1 block text-xs text-store-muted-foreground">
              {address.notes}
            </span>
          )}
        </ReviewRow>

        <ReviewRow
          label={t("delivery.heading")}
          onEdit={() => onEdit("delivery")}
          editLabel={t("review.editDelivery")}
          t={t}
        >
          <span className="block">
            {method ? t(`delivery.methods.${method}`) : t("review.notSet")}
          </span>
          {/* COM-MOBILE-SHIPPING-1: real and server-committed the moment a
              method is saved (`ShippingRateService`), never a placeholder —
              this is what the order summary panel's total already includes. */}
          <span className="mt-1 block text-xs text-store-muted-foreground">
            {method
              ? formatMinorAmount(checkout.delivery.amount)
              : t("delivery.amountPending")}
          </span>
        </ReviewRow>

        {stages.includes("schedule") && (
          <ReviewRow
            label={t("review.scheduleLabel")}
            onEdit={() => onEdit("schedule")}
            editLabel={t("review.editSchedule")}
            t={t}
          >
            {checkout.schedule?.slot ? (
              <ScheduleSummary
                date={checkout.schedule.date}
                slot={checkout.schedule.slot}
                locale={locale}
                t={t}
              />
            ) : (
              <span className="block">{t("review.notSet")}</span>
            )}
          </ReviewRow>
        )}

        {stages.includes("gift") && (
          <ReviewRow
            label={t("review.giftLabel")}
            onEdit={() => onEdit("gift")}
            editLabel={t("review.editGift")}
            t={t}
          >
            {checkout.gift ? (
              <GiftSummary gift={checkout.gift} t={t} />
            ) : (
              <span className="block">{t("review.notSet")}</span>
            )}
          </ReviewRow>
        )}

        <ReviewRow
          label={t("payment.heading")}
          onEdit={() => onEdit("payment")}
          editLabel={t("review.editPayment")}
          t={t}
        >
          <span className="block">
            {checkout.payment.payment_method_name ??
              t("payment.noMethodsEnabled")}
          </span>
        </ReviewRow>
      </dl>

      <p className="mt-5 flex items-start gap-2 rounded-store border border-store-border bg-store-surface-muted p-4 text-sm leading-relaxed text-store-foreground">
        <ShieldAlert
          className="mt-0.5 w-4 h-4 shrink-0 text-store-muted-foreground"
          aria-hidden="true"
        />
        <span>{t("review.commitmentNotice")}</span>
      </p>
    </StageShell>
  );
}

function ScheduleSummary({
  date,
  slot,
  locale,
  t,
}: {
  date: string;
  slot: {
    label: string;
    labelEn: string | null;
    startTime: string;
    endTime: string;
  };
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  // The stored checkout carries no timezone, so a plain calendar date — never
  // a "today"/"tomorrow" the browser would have to guess.
  const day = formatPlainDate(date, locale);
  const window = formatDeliveryWindow(slot.startTime, slot.endTime, locale);
  const label =
    locale.toLowerCase().startsWith("en") && slot.labelEn
      ? slot.labelEn
      : slot.label;
  return (
    <>
      <span className="block">{day}</span>
      <span className="mt-1 block text-xs text-store-muted-foreground">
        {label}
        {window ? <bdi className="ms-2">{window}</bdi> : null}
      </span>
      <span className="sr-only">{t("schedule.requestedNote")}</span>
    </>
  );
}

function GiftSummary({
  gift,
  t,
}: {
  gift: NonNullable<StorefrontCheckout["gift"]>;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      <span className="block">
        {t("review.giftTo")}: {gift.recipientName}
        {gift.recipientPhone ? (
          <span className="ms-2">
            <bdi dir="ltr">{gift.recipientPhone}</bdi>
          </span>
        ) : null}
      </span>
      <span className="mt-1 block text-xs text-store-muted-foreground">
        {t("review.giftFrom")}:{" "}
        {gift.hideSender
          ? t("review.giftAnonymous")
          : (gift.senderDisplayName ?? t("review.notSet"))}
      </span>
      {gift.message ? (
        <span className="mt-1 block whitespace-pre-line text-xs text-store-muted-foreground">
          {t("review.giftMessage")}: {gift.message}
        </span>
      ) : null}
    </>
  );
}

function ReviewRow({
  label,
  editLabel,
  onEdit,
  children,
  t,
}: {
  label: string;
  editLabel: string | null;
  onEdit: () => void;
  children: React.ReactNode;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-store-muted-foreground">
          {label}
        </dt>
        <dd className="mt-1 text-sm text-store-foreground">{children}</dd>
      </div>
      {editLabel && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-store-primary"
          onClick={onEdit}
          aria-label={editLabel}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          {t("review.edit")}
        </Button>
      )}
    </div>
  );
}
