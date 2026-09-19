"use client";

import { Banknote, CreditCard, Landmark, Lock } from "lucide-react";
import type { useTranslations } from "next-intl";
import { StageShell } from "@/components/checkout/awj/StageShell";
import { PAYMENT_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * Stage 4 — payment.
 *
 * **DESIGN_ONLY / GATED.** See `PAYMENT_CAPABILITY`: AWJ `store/v1` has no
 * payment route, there is no `PaymentIntent` model, and ADR-04 is an accepted
 * architecture direction with no implementation approval. The journey has a
 * payment moment, so the moment is designed; nothing behind it is pretended.
 *
 * The rules this stage keeps, all of them from the design-first policy §3/§5.6
 * and the slice's own guardrails:
 *
 * - **No provider is named and no brand mark is shown.** A payment mark is a
 *   commercial claim about who this store can charge you through, and the
 *   platform has made none.
 * - **The method types below are shown as not enabled, and none is
 *   selectable.** They are the shape of the choice, not an offer of it. A
 *   selectable option would be a claim that the store accepts it.
 * - **No card field exists anywhere in this component.** Card data must never
 *   pass through AWJ — when this activates, the provider's own element takes
 *   this space and the card number never reaches this origin.
 * - **Nothing is submitted, stored or remembered.** Continuing from here
 *   advances the flow and calls nothing, because there is nothing to call.
 *
 * What the shopper is told instead is the truth that the next stage acts on:
 * placing the order records a commercial commitment, and no payment is taken.
 */

const METHOD_SHAPES = [
  { key: "card", Icon: CreditCard },
  { key: "bankTransfer", Icon: Landmark },
  { key: "cashOnDelivery", Icon: Banknote },
] as const;

export function PaymentStage({ t }: { t: ReturnType<typeof useTranslations> }) {
  // Reads as a constant today; it is the switch that flips when the contract
  // lands, and it is what keeps this stage from being rewritten then.
  const live = PAYMENT_CAPABILITY === "live";

  return (
    <StageShell
      id="awj-checkout-payment"
      title={t("payment.heading")}
      description={t("payment.description")}
    >
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
            {t("payment.notEnabledTitle")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
            {t("payment.notEnabledBody")}
          </p>
        </div>
      </div>

      {!live && (
        <ul className="mt-4 space-y-2" aria-label={t("payment.plannedLabel")}>
          {METHOD_SHAPES.map(({ key, Icon }) => (
            <li
              key={key}
              className="flex items-center gap-3 rounded-store border border-dashed border-store-border px-4 py-3 opacity-70"
            >
              <Icon
                className="w-5 h-5 shrink-0 text-store-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1 text-sm font-medium text-store-muted-foreground">
                {t(`payment.methods.${key}`)}
              </span>
              <span className="rounded-md bg-store-surface-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-store-muted-foreground">
                {t("payment.notEnabledBadge")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StageShell>
  );
}
