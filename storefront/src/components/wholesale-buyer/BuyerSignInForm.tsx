"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInBuyer } from "@/lib/data/wholesale-buyer";
import { extractBasePath } from "@/lib/utils/path";

/**
 * Wholesale buyer sign-in (H6 Batch G). Credentials go to a server action that
 * calls the existing `store/v1/auth/login`; the session token never reaches this
 * component. Failures show one message whatever the cause (unknown email, wrong
 * password, unverified email) — the API deliberately does not distinguish them.
 */
export function BuyerSignInForm({ nextPath }: { nextPath: string }) {
  const t = useTranslations("wholesaleBuyer");
  const router = useRouter();
  const basePath = extractBasePath(usePathname());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signInBuyer(email, password);
      if (result.success) {
        router.push(nextPath);
        router.refresh();
        return;
      }
      setError(t(`errors.${result.error}`));
    });
  };

  return (
    <AccountAuthCard
      title={t("signIn.title")}
      description={t("signIn.description")}
      footer={
        <div className="space-y-2">
          <p>{t("signIn.footer")}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href={`${basePath}/buyer/register`}
              className="font-medium text-store-primary hover:text-store-primary-hover"
            >
              {t("signIn.registerLink")}
            </Link>
            <Link
              href={`${basePath}/buyer/resend`}
              className="font-medium text-store-primary hover:text-store-primary-hover"
            >
              {t("signIn.resendLink")}
            </Link>
            <Link
              href={`${basePath}/buyer/forgot-password`}
              className="font-medium text-store-primary hover:text-store-primary-hover"
            >
              {t("signIn.forgotLink")}
            </Link>
          </p>
        </div>
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
          <FieldLabel htmlFor="buyer-email">{t("signIn.email")}</FieldLabel>
          <Input
            id="buyer-email"
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
          id="buyer-password"
          label={t("signIn.password")}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          showLabel={t("signIn.showPassword")}
          hideLabel={t("signIn.hidePassword")}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
