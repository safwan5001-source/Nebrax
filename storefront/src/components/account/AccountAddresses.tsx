"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { Button } from "@/components/ui/button";
import { ACCOUNT_ADDRESSES_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * Saved-address book.
 *
 * **DESIGN_ONLY.** There is no customer-address persistence contract on
 * AWJ. Add / edit / remove never write anything, never report success,
 * and never fall back to browser storage. The card shape is the intended
 * UX so the surface does not have to be redesigned when the book lands.
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
          {t("addresses")}
        </h1>
        <Button type="button" variant="outline" onClick={refuse}>
          {t("addNewAddress")}
        </Button>
      </div>

      <div className="mt-4">
        <AccountGatedNotice
          title={t("addressesNotEnabledTitle")}
          body={t("addressesNotEnabledBody")}
        />
      </div>

      {message && (
        <p role="status" className="mt-3 text-sm text-store-muted-foreground">
          {message}
        </p>
      )}

      <div className="mt-4 rounded-store border border-dashed border-store-border bg-store-surface">
        <AccountEmptyState
          icon={MapPin}
          title={t("noAddresses")}
          description={t("noAddressesDescription")}
        />
      </div>

      <article
        aria-label={t("addressCardShape")}
        className="mt-4 rounded-store border border-dashed border-store-border px-4 py-4 opacity-70"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-store-foreground">
              {t("addressCardTitle")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
              {t("addressCardExample")}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-store-surface-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-store-muted-foreground">
            {t("defaultAddress")}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refuse}>
            {t("editAddress")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={refuse}>
            {t("removeAddress")}
          </Button>
        </div>
      </article>
    </div>
  );
}
