"use client";

import { CreditCard, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { Button } from "@/components/ui/button";
import { ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * Intended saved-method cards. The mask and expiry are synthetic visual
 * fixtures (not a PAN, not a brand, not a live instrument).
 */
const METHOD_FIXTURES = [
  { key: "card" as const, Icon: CreditCard, showExpiry: true, isDefault: true },
  { key: "bank" as const, Icon: Landmark, showExpiry: false, isDefault: false },
] as const;

/**
 * Saved payment methods.
 *
 * **DESIGN_ONLY.** No provider is named, no brand mark is shown, no card
 * field exists, and add/remove never report success or persist anything.
 * The cards are the intended shape of a saved-method book, not a broken
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
      <header className="flex flex-wrap items-end justify-between gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-x-3 lg:border-b lg:border-store-border lg:pb-5">
        <h1 className="text-xl font-bold text-store-foreground lg:text-2xl">
          {t("paymentMethods")}
        </h1>
        <Button type="button" variant="outline" size="sm" onClick={refuse}>
          {t("addPaymentMethod")}
        </Button>
        <div className="hidden lg:col-start-1 lg:row-start-2 lg:mt-1 lg:block">
          <AccountGatedNotice
            title={t("paymentNotEnabledTitle")}
            body={t("paymentNotEnabledBody")}
          />
        </div>
      </header>

      <div className="mt-2 lg:hidden">
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
        className="mt-5 grid grid-cols-1 gap-3 lg:mt-6 lg:grid-cols-2 lg:gap-6"
        aria-label={t("savedMethodShape")}
      >
        {METHOD_FIXTURES.map(({ key, Icon, showExpiry, isDefault }) => (
          <li key={key}>
            <article className="flex h-full flex-col rounded-store border border-store-border bg-store-surface px-4 py-4 lg:px-8 lg:py-7">
              <div className="flex items-start gap-3 lg:gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-store border border-store-border lg:size-12">
                  <Icon
                    className="size-4 text-store-foreground lg:size-5"
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-store-foreground lg:text-base lg:font-semibold">
                      {t(`savedMethod.${key}`)}
                    </p>
                    {isDefault ? (
                      <span className="shrink-0 text-[0.6875rem] font-medium text-store-muted-foreground lg:rounded-store lg:border lg:border-store-border lg:px-2 lg:py-0.5 lg:text-xs">
                        {t("defaultAddress")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-sm tracking-wide text-store-muted-foreground lg:mt-2 lg:text-base">
                    <bdi>{t("methodMask")}</bdi>
                  </p>
                  {showExpiry ? (
                    <p className="mt-0.5 text-xs text-store-muted-foreground lg:mt-1 lg:text-sm">
                      <bdi>{t("methodExpiry")}</bdi>
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto pt-4 lg:mt-6 lg:border-t lg:border-store-border lg:pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={refuse}
                >
                  {t("removePaymentMethod")}
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
