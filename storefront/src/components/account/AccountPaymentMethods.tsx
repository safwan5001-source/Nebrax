"use client";

import { CreditCard, Landmark, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { Button } from "@/components/ui/button";
import { ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY } from "@/lib/commerce/capabilities";

const METHOD_SHAPES = [
  { key: "card" as const, Icon: CreditCard },
  { key: "bank" as const, Icon: Landmark },
] as const;

/**
 * Saved payment methods.
 *
 * **DESIGN_ONLY.** No provider is named, no brand mark is shown, no card
 * field exists, and add/remove never report success or persist anything.
 */
export function AccountPaymentMethods() {
  const t = useTranslations("account");
  const [message, setMessage] = useState<string | null>(null);
  const gated = ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY !== "live";

  const refuse = () => {
    if (!gated) return;
    setMessage(t("paymentActionUnavailable"));
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
          {t("paymentMethods")}
        </h1>
        <Button type="button" variant="outline" onClick={refuse}>
          {t("addPaymentMethod")}
        </Button>
      </div>

      <div className="mt-4">
        <AccountGatedNotice
          title={t("paymentNotEnabledTitle")}
          body={t("paymentNotEnabledBody")}
        />
      </div>

      {message && (
        <p role="status" className="mt-3 text-sm text-store-muted-foreground">
          {message}
        </p>
      )}

      <div className="mt-4 rounded-store border border-store-border bg-store-surface">
        <AccountEmptyState
          icon={Lock}
          title={t("noPaymentMethods")}
          description={t("noPaymentMethodsDescription")}
        />
      </div>

      <ul className="mt-4 space-y-2" aria-label={t("savedMethodShape")}>
        {METHOD_SHAPES.map(({ key, Icon }) => (
          <li
            key={key}
            className="flex items-center gap-3 rounded-store border border-dashed border-store-border px-4 py-3 opacity-70"
          >
            <Icon
              className="size-5 shrink-0 text-store-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 text-sm font-medium text-store-muted-foreground">
              {t(`savedMethod.${key}`)}
            </span>
            <span className="rounded-md bg-store-surface-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-store-muted-foreground">
              {t("notEnabledBadge")}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={refuse}>
              {t("removePaymentMethod")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
