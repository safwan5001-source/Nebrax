"use client";

import { Info, Store, Truck } from "lucide-react";
import type { useTranslations } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AWJ_DELIVERY_METHODS,
  type AwjDeliveryMethod,
} from "@/lib/commerce/checkout-types";

/**
 * Stage 3 — how the order reaches the shopper.
 *
 * The two methods are `CommerceCheckoutService::DELIVERY_METHODS` verbatim.
 * They are a real, stored choice: `PATCH store/v1/checkout/delivery` writes the
 * method to the checkout and carries it onto the order.
 *
 * **No price, no estimate, no date.** `updateDelivery()` sets
 * `delivery_amount_minor` to `0` unconditionally because no shipping pricing
 * authority exists, and the controller accepts no amount from the client at
 * all. Rendering that zero as "free delivery" would turn a placeholder into a
 * commercial offer; rendering an arrival window would invent a promise nothing
 * in this system makes. Each option says what it is and the stage says once,
 * plainly, that the delivery charge is confirmed by the store.
 */

const METHOD_ICON: Record<AwjDeliveryMethod, typeof Truck> = {
  pickup: Store,
  standard: Truck,
};

export function DeliveryStage({
  method,
  onChange,
  t,
}: {
  method: AwjDeliveryMethod | null;
  onChange: (method: AwjDeliveryMethod) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StageShell
      id="awj-checkout-delivery"
      title={t("delivery.heading")}
      description={t("delivery.description")}
    >
      <RadioGroup
        value={method ?? undefined}
        onValueChange={(value) => onChange(value as AwjDeliveryMethod)}
        className="gap-3"
      >
        {AWJ_DELIVERY_METHODS.map((option) => {
          const Icon = METHOD_ICON[option];
          return (
            <label
              key={option}
              htmlFor={`awj-delivery-${option}`}
              className="flex cursor-pointer items-start gap-3 rounded-store border border-store-border bg-store-surface p-4 transition-colors hover:border-store-border-strong has-[[data-state=checked]]:border-store-primary has-[[data-state=checked]]:bg-store-primary-soft"
            >
              <RadioGroupItem
                id={`awj-delivery-${option}`}
                value={option}
                className="mt-0.5"
              />
              <Icon
                className="mt-0.5 w-5 h-5 shrink-0 text-store-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1">
                <span className="block text-sm font-bold text-store-foreground">
                  {t(`delivery.methods.${option}`)}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-store-muted-foreground">
                  {t(`delivery.descriptions.${option}`)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-store-muted-foreground">
                {t("delivery.amountPending")}
              </span>
            </label>
          );
        })}
      </RadioGroup>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-store-muted-foreground">
        <Info className="mt-px w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{t("delivery.pricingNotice")}</span>
      </p>
    </StageShell>
  );
}
