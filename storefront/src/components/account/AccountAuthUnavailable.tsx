"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Button } from "@/components/ui/button";
import { extractBasePath } from "@/lib/utils/path";

/**
 * Honest replacement for the sign-in / register / recovery / profile forms
 * while `ACCOUNT_AUTH_CAPABILITY` is not `live` (SPREE-X1).
 *
 * It renders no input, so nothing can be submitted into a backend that does not
 * exist, never reports success, never names a provider and never shows an
 * internal error. The way forward for a shopper is the guest journey, which is
 * AWJ-native and unaffected. All copy is localized (`accountGate` namespace);
 * layout uses logical properties only, so RTL and LTR both hold.
 */
export function AccountAuthUnavailable() {
  const t = useTranslations("accountGate");
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);

  return (
    <AccountAuthCard title={t("title")} description={t("body")}>
      <div
        role="status"
        data-testid="account-auth-unavailable"
        className="flex flex-col gap-2 sm:flex-row"
      >
        <Button size="lg" className="sm:flex-1" asChild>
          <Link href={basePath || "/"}>{t("continueShopping")}</Link>
        </Button>
        <Button size="lg" variant="outline" className="sm:flex-1" asChild>
          <Link href={`${basePath}/cart`}>{t("viewCart")}</Link>
        </Button>
      </div>
    </AccountAuthCard>
  );
}
