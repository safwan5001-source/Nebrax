"use client";

import { Pencil, ShieldAlert } from "lucide-react";
import type { useTranslations } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { StorefrontCheckout } from "@/lib/commerce/checkout-types";

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
 * commercial commitment, and no payment is taken, because none can be. That
 * sentence is the reason the payment stage is allowed to be inert.
 */
export function ReviewStage({
  checkout,
  onEdit,
  t,
}: {
  checkout: StorefrontCheckout;
  onEdit: (stage: "contact" | "address" | "delivery") => void;
  t: ReturnType<typeof useTranslations>;
}) {
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

        <ReviewRow
          label={t("payment.heading")}
          onEdit={() => onEdit("delivery")}
          editLabel={null}
          t={t}
        >
          <span className="block">{t("payment.notEnabledTitle")}</span>
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
