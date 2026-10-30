"use client";

import { CircleAlert, MailCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { registerBuyer } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

/**
 * Wholesale buyer registration (H6 Batch H). The API answers the same "check your e-mail" result for a new and an
 * existing address, and this form shows exactly that — it never says whether the address was already registered.
 * The account stays unverified (no sign-in) until the e-mailed link is confirmed.
 */
export function BuyerRegisterForm() {
  const t = useTranslations("wholesaleBuyer");
  const basePath = extractBasePath(usePathname());
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerBuyer({
        displayName,
        email,
        password,
        basePath,
      });
      if (result.success) setDone(true);
      else setError(t(`errors.${result.error}`));
    });
  };

  if (done) {
    return (
      <AccountAuthCard
        title={t("register.doneTitle")}
        footer={
          <Link
            href={`${basePath}/buyer/resend`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("register.resendLink")}
          </Link>
        }
      >
        <div className="flex gap-3" data-state="registered">
          <MailCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-store-primary"
          />
          <p className="text-sm leading-relaxed text-store-foreground">
            {t("register.doneBody")}
          </p>
        </div>
      </AccountAuthCard>
    );
  }

  return (
    <AccountAuthCard
      title={t("register.title")}
      description={t("register.description")}
      footer={
        <p>
          {t("register.haveAccount")}{" "}
          <Link
            href={`${basePath}/buyer/sign-in`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("signIn.submit")}
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="buyer-name">
            {t("register.displayName")}
          </FieldLabel>
          <Input
            id="buyer-name"
            name="display_name"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            maxLength={255}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="buyer-reg-email">{t("signIn.email")}</FieldLabel>
          <Input
            id="buyer-reg-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <AccountPasswordField
          id="buyer-reg-password"
          label={t("signIn.password")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("register.submitting") : t("register.submit")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
