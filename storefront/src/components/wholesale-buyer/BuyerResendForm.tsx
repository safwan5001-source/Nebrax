"use client";

import { CircleAlert, MailCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resendBuyerVerification } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

/** Ask for a fresh verification e-mail. The answer is the same for every address; this form never says whether one was sent. */
export function BuyerResendForm() {
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
      const result = await resendBuyerVerification({ email, basePath });
      if (result.success) setDone(true);
      else setError(t(`errors.${result.error}`));
    });
  };

  return (
    <AccountAuthCard
      title={t("resend.title")}
      description={t("resend.description")}
    >
      {done ? (
        <p
          className="flex gap-3 text-sm leading-relaxed text-store-foreground"
          data-state="resent"
        >
          <MailCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-store-primary"
          />
          {t("resend.doneBody")}
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
            <FieldLabel htmlFor="buyer-resend-email">
              {t("signIn.email")}
            </FieldLabel>
            <Input
              id="buyer-resend-email"
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
            {pending ? t("resend.submitting") : t("resend.submit")}
          </Button>
        </form>
      )}
    </AccountAuthCard>
  );
}
