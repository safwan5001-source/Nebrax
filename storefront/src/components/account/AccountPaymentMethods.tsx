"use client";

import { CreditCard, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
 * The rows are the intended shape of a saved-method list, not a broken
 * live list.
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
        <h1 className="text-xl font-bold text-store-foreground">
          {t("paymentMethods")}
        </h1>
        <Button type="button" variant="outline" size="sm" onClick={refuse}>
          {t("addPaymentMethod")}
        </Button>
      </div>

      <div className="mt-2">
        <AccountGatedNotice
          title={t("paymentNotEnabledTitle")}
          body={t("paymentNotEnabledBody")}
        />
      </div>

      {message && (
        <p role="status" className="mt-2 text-sm text-store-muted-foreground">
          {message}
        </p>
      )}

      <ul
        className="mt-5 divide-y divide-store-border overflow-hidden rounded-store border border-dashed border-store-border"
        aria-label={t("savedMethodShape")}
      >
        {METHOD_SHAPES.map(({ key, Icon }) => (
          <li key={key} className="flex items-center gap-3 px-4 py-3">
            <Icon
              className="size-4 shrink-0 text-store-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 text-sm text-store-muted-foreground">
              {t(`savedMethod.${key}`)}
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
