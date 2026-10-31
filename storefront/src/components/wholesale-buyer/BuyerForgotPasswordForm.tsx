"use client";

import { CircleAlert, MailCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestBuyerPasswordReset } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

/**
 * Ask for a password-reset e-mail (H6 Batch M). The answer is the same for every address — known, unknown, unverified or
 * cooling down — so this form never says whether a mail was sent.
 */
export function BuyerForgotPasswordForm() {
  const t = useTranslations("wholesaleBuyer");
  const basePath = extractBasePath(usePathname());
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestBuyerPasswordReset({ email, basePath });
      if (result.success) setDone(true);
      else setError(t(`errors.${result.error}`));
    });
  };

  return (
    <AccountAuthCard
      title={t("forgot.title")}
      description={t("forgot.description")}
      footer={
        <Link
          href={`${basePath}/buyer/sign-in`}
          className="font-medium text-store-primary hover:text-store-primary-hover"
        >
          {t("forgot.backToSignIn")}
        </Link>
      }
    >
      {done ? (
        <p
          className="flex gap-3 text-sm leading-relaxed text-store-foreground"
          data-state="requested"
        >
          <MailCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-store-primary"
          />
          {t("forgot.doneBody")}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="buyer-forgot-email">
              {t("signIn.email")}
            </FieldLabel>
            <Input
              id="buyer-forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("forgot.submitting") : t("forgot.submit")}
          </Button>
        </form>
      )}
    </AccountAuthCard>
  );
}
