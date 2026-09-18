"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AccountShell } from "./AccountShell";

function SessionFallback() {
  const t = useTranslations("common");

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
          className="h-32 rounded-store bg-store-surface-muted"
        />
      </div>
    </div>
  );
}

interface AuthenticatedAccountShellProps {
  children: React.ReactNode;
  loginHref: string;
}

/**
 * The server layout rejects requests with no session credentials. This client
 * boundary verifies the remaining session before exposing account chrome and
 * preserves the existing refresh-token recovery flow.
 */
export function AuthenticatedAccountShell({
  children,
  loginHref,
}: AuthenticatedAccountShellProps) {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace(loginHref);
  }, [isAuthenticated, loading, loginHref, router]);

  if (loading || !isAuthenticated) return <SessionFallback />;

  return <AccountShell>{children}</AccountShell>;
}
