"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resetBuyerPassword } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

const MIN_LENGTH = 8;

/**
 * Sets a new password from the e-mailed link (H6 Batch M). Like e-mail confirmation, nothing is consumed while the page
 * renders: the single-use token is spent only when the buyer submits a valid new password. Every failure — wrong, expired,
 * already used, another store's link — is one message and keeps the form so the buyer can request a fresh link.
 */
export function BuyerResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("wholesaleBuyer");
  const basePath = extractBasePath(usePathname());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"idle" | "ok" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  if (outcome === "ok") {
    return (
      <AccountAuthCard title={t("reset.successTitle")}>
        <div className="space-y-4" data-state="reset-done">
          <p className="flex gap-3 text-sm leading-relaxed text-store-foreground">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-store-primary"
            />
            {t("reset.successBody")}
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
      <AccountAuthCard title={t("reset.failedTitle")}>
        <div className="space-y-4" data-state="reset-failed">
          <p className="flex gap-3 text-sm leading-relaxed text-store-foreground">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            {token ? t("reset.failedBody") : t("reset.missingToken")}
          </p>
          <Button asChild className="w-full">
            <Link href={`${basePath}/buyer/forgot-password`}>
              {t("reset.requestNew")}
            </Link>
          </Button>
        </div>
      </AccountAuthCard>
    );
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(t("reset.tooShort", { min: MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("reset.mismatch"));
      return;
    }
    startTransition(async () => {
      const result = await resetBuyerPassword({ token, password });
      if (result.success) setOutcome("ok");
      else if (result.error === "rateLimited")
        setError(t("errors.rateLimited"));
      else setOutcome("failed");
    });
  };

  return (
    <AccountAuthCard
      title={t("reset.title")}
      description={t("reset.description")}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AccountPasswordField
          id="buyer-reset-password"
          label={t("reset.newPassword")}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
          value={password}
          onChange={setPassword}
        />
        <AccountPasswordField
          id="buyer-reset-confirm"
          label={t("reset.confirmPassword")}
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
          value={confirm}
          onChange={setConfirm}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("reset.submitting") : t("reset.submit")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
