"use client";

import { Banknote, Info, Lock } from "lucide-react";
import type { useTranslations } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  AwjDeliveryMethod,
  AwjPaymentMethod,
} from "@/lib/commerce/checkout-types";

/**
 * Stage 4 — payment.
 *
 * **Two things are true at once here, per `PAYMENT_CAPABILITY`'s own doc:**
 * online/card payment (`PAYMENT_CAPABILITY`) is still `design_only` — no
 * provider, no brand mark, no card field anywhere in this component, ever.
 * But COM-MOBILE-PAYMENTS-1 (ADR-09) made a narrower thing real: the
 * checkout now has a genuine `PATCH checkout/payment` contract for the
 * store's own enabled cash-settlement methods (`GET checkout/payment-
 * methods`, gated by `PaymentMethodChannelAvailabilityService`). This stage
 * shows exactly those, and nothing wider.
 *
 * **The list is real, not a shape.** Selecting an option here calls the real
 * endpoint and is genuinely stored. An empty list is the honest default (see
 * `fetchAwjPaymentMethods`'s own doc) — every default-seeded method starts
 * disabled for any online channel — and is presented as such, not as a
 * loading state or an error.
 *
 * **This never decides how much is charged or when.** The amount is the
 * order total the review stage already shows; timing is COD-style (settled
 * on delivery or on pickup, never at order placement — ADR-04 §5). The
 * choice here is only which of the store's enabled methods collects it.
 */

export function PaymentStage({
  paymentMethods,
  selectedPaymentMethodId,
  onChange,
  deliveryMethod,
  t,
}: {
  paymentMethods: AwjPaymentMethod[];
  selectedPaymentMethodId: string | null;
  onChange: (id: string) => void;
  deliveryMethod: AwjDeliveryMethod | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const hasEnabledMethods = paymentMethods.length > 0;

  return (
    <StageShell
      id="awj-checkout-payment"
      title={t("payment.heading")}
      description={t("payment.description")}
    >
      {hasEnabledMethods ? (
        <>
          <RadioGroup
            value={selectedPaymentMethodId ?? undefined}
            onValueChange={onChange}
            className="gap-3"
            aria-label={t("payment.selectMethod")}
          >
            {paymentMethods.map((method) => (
              <label
                key={method.id}
                htmlFor={`awj-payment-${method.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-store border border-store-border bg-store-surface p-4 transition-colors hover:border-store-border-strong has-[[data-state=checked]]:border-store-primary has-[[data-state=checked]]:bg-store-primary-soft"
              >
                <RadioGroupItem
                  id={`awj-payment-${method.id}`}
                  value={method.id}
                  className="mt-0.5"
                />
                <Banknote
                  className="mt-0.5 w-5 h-5 shrink-0 text-store-muted-foreground"
                  aria-hidden="true"
                />
                <span className="flex-1 text-sm font-bold text-store-foreground">
                  {method.name}
                </span>
              </label>
            ))}
          </RadioGroup>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-store-muted-foreground">
            <Info className="mt-px w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {deliveryMethod === "pickup"
                ? t("payment.settledOnPickup")
                : t("payment.settledOnDelivery")}
            </span>
          </p>
        </>
      ) : (
        <div
          role="status"
          className="flex items-start gap-3 rounded-store border border-store-border bg-store-surface-muted p-4"
        >
          <Lock
            className="mt-0.5 w-4 h-4 shrink-0 text-store-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-bold text-store-foreground">
              {t("payment.noMethodsEnabled")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
              {t("payment.notEnabledBody")}
            </p>
          </div>
        </div>
      )}
    </StageShell>
  );
}
