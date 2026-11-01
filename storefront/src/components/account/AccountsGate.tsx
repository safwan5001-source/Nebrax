"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { AccountAuthUnavailable } from "@/components/account/AccountAuthUnavailable";
import { useAuth } from "@/contexts/AuthContext";

/**
 * B2C-ACCOUNTS — the one place the account screens ask "does this store have customer accounts?".
 *
 * The answer is the API's (`capabilities.customer_accounts`, fail closed), surfaced by the session provider. Until it
 * answers a quiet skeleton is shown; if the host has no accounts the honest {@link AccountAuthUnavailable} notice is
 * rendered instead of any form — so a store that has not been switched on looks exactly as it did before this feature.
 */
export function AccountsGate({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const { accountsAvailable, checkAccountsAvailable } = useAuth();

  // A visitor with no session never triggered the provider's sync: ask the API once, here, where it is actually needed.
  useEffect(() => {
    if (accountsAvailable === null) void checkAccountsAvailable();
  }, [accountsAvailable, checkAccountsAvailable]);

  if (accountsAvailable === null) {
    return (
      <div className="mx-auto w-full max-w-store px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md animate-pulse space-y-4 motion-reduce:animate-none">
          <span className="sr-only">{t("loading")}</span>
          <div
            aria-hidden="true"
            className="mx-auto h-8 w-1/2 rounded-store bg-store-surface-muted"
          />
          <div
            aria-hidden="true"
            className="h-48 rounded-store bg-store-surface-muted"
          />
        </div>
      </div>
    );
  }

  if (!accountsAvailable) return <AccountAuthUnavailable />;
  return <>{children}</>;
}
