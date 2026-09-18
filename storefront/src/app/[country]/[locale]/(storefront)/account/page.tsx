"use client";

import { useTranslations } from "next-intl";
import { AccountOverview } from "@/components/account/AccountOverview";
import { AccountShell } from "@/components/account/AccountShell";
import { AccountSignIn } from "@/components/account/AccountSignIn";
import { useAuth } from "@/contexts/AuthContext";

export default function AccountPage() {
  const t = useTranslations("common");
  const { isAuthenticated, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-store px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md space-y-4 animate-pulse motion-reduce:animate-none">
          <span className="sr-only">{t("loading")}</span>
          <div
            aria-hidden="true"
            className="mx-auto h-8 w-1/2 rounded-store bg-store-surface-muted"
          />
          <div
            aria-hidden="true"
            className="mx-auto h-4 w-3/4 rounded-store bg-store-surface-muted"
          />
          <div
            aria-hidden="true"
            className="h-48 rounded-store bg-store-surface-muted"
          />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AccountSignIn />;
  }

  return (
    <AccountShell>
      <AccountOverview />
    </AccountShell>
  );
}
