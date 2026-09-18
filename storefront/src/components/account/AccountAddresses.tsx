"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { Button } from "@/components/ui/button";
import { ACCOUNT_ADDRESSES_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * Intended address-book cards. Locale strings only — not customer records,
 * not a production default, and never written anywhere.
 */
const ADDRESS_FIXTURES = [
  {
    id: "primary",
    name: "addressFixture.name",
    line1: "addressFixture.line1",
    line2: "addressFixture.line2",
    cityPostal: "addressFixture.cityPostal",
    country: "addressFixture.country",
    isDefault: true,
  },
  {
    id: "secondary",
    name: "addressFixtureAlt.name",
    line1: "addressFixtureAlt.line1",
    line2: "addressFixtureAlt.line2",
    cityPostal: "addressFixtureAlt.cityPostal",
    country: "addressFixtureAlt.country",
    isDefault: false,
  },
] as const;

/**
 * Saved-address book.
 *
 * **DESIGN_ONLY.** There is no customer-address persistence contract on
 * AWJ. Add / edit / remove never write anything, never report success,
 * and never fall back to browser storage. The cards are the intended UX
 * so the surface does not have to be redesigned when the book lands.
 */
export function AccountAddresses() {
  const t = useTranslations("account");
  const [message, setMessage] = useState<string | null>(null);
  const gated = ACCOUNT_ADDRESSES_CAPABILITY !== "live";

  const refuse = () => {
    if (!gated) return;
    setMessage(t("addressActionUnavailable"));
  };

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3 lg:items-center lg:border-b lg:border-store-border lg:pb-5">
        <h1 className="text-xl font-bold text-store-foreground lg:text-2xl">
          {t("addresses")}
        </h1>
        <Button type="button" variant="outline" size="sm" onClick={refuse}>
          {t("addNewAddress")}
        </Button>
      </header>

      <div className="mt-2 lg:mt-4">
        <AccountGatedNotice
          title={t("addressesNotEnabledTitle")}
          body={t("addressesNotEnabledBody")}
        />
      </div>

      {message && (
        <p role="status" className="mt-2 text-sm text-store-muted-foreground">
          {message}
        </p>
      )}

      <ul
        aria-label={t("addressCardShape")}
        className="mt-5 grid grid-cols-1 gap-3 lg:mt-8 lg:grid-cols-2 lg:gap-6"
      >
        {ADDRESS_FIXTURES.map((fixture) => (
          <li key={fixture.id}>
            <article className="flex h-full flex-col rounded-store border border-store-border bg-store-surface px-4 py-4 lg:px-8 lg:py-7">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-store-foreground lg:text-base lg:font-semibold">
                  {t(fixture.name)}
                </p>
                {fixture.isDefault ? (
                  <span className="shrink-0 text-[0.6875rem] font-medium text-store-muted-foreground lg:rounded-store lg:border lg:border-store-border lg:px-2 lg:py-0.5 lg:text-xs">
                    {t("defaultAddress")}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 space-y-0.5 text-sm leading-relaxed text-store-muted-foreground lg:mt-4 lg:space-y-1">
                <p>{t(fixture.line1)}</p>
                <p>{t(fixture.line2)}</p>
                <p>{t(fixture.cityPostal)}</p>
                <p>{t(fixture.country)}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-4 lg:mt-6 lg:border-t lg:border-store-border lg:pt-5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refuse}
                >
                  {t("editAddress")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={refuse}
                >
                  {t("removeAddress")}
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
