"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Button } from "@/components/ui/button";
import { verifyBuyerEmail } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

/**
 * Confirms the e-mailed link (H6 Batch H). The token is consumed only when the buyer presses the button — never while
 * the page renders — so a mail scanner or link prefetcher that merely opens the link cannot burn the single-use token.
 */
export function BuyerVerifyEmail({ token }: { token: string | null }) {
  const t = useTranslations("wholesaleBuyer");
  const basePath = extractBasePath(usePathname());
  const [outcome, setOutcome] = useState<"idle" | "ok" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    if (!token) return;
    startTransition(async () => {
      const result = await verifyBuyerEmail(token);
      setOutcome(result.success ? "ok" : "failed");
    });
  };

  if (outcome === "ok") {
    return (
      <AccountAuthCard title={t("verify.successTitle")}>
        <div className="space-y-4" data-state="verified">
          <p className="flex gap-3 text-sm leading-relaxed text-store-foreground">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-store-primary"
            />
            {t("verify.successBody")}
          </p>
          <Button asChild className="w-full">
            <Link href={`${basePath}/buyer/sign-in`}>{t("signIn.submit")}</Link>
          </Button>
        </div>
      </AccountAuthCard>
    );
  }

  if (!token || outcome === "failed") {
    return (
      <AccountAuthCard title={t("verify.failedTitle")}>
        <div className="space-y-4" data-state="failed">
          <p className="flex gap-3 text-sm leading-relaxed text-store-foreground">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            {token ? t("verify.failedBody") : t("verify.missingToken")}
          </p>
          <Button asChild className="w-full">
            <Link href={`${basePath}/buyer/resend`}>
              {t("verify.resendCta")}
            </Link>
          </Button>
        </div>
      </AccountAuthCard>
    );
  }

  return (
    <AccountAuthCard
      title={t("verify.title")}
      description={t("verify.description")}
    >
      <Button
        type="button"
        className="w-full"
        onClick={confirm}
        disabled={pending}
      >
        {pending ? t("verify.confirming") : t("verify.confirm")}
      </Button>
    </AccountAuthCard>
  );
}
