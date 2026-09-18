"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/data/customer";
import { extractBasePath } from "@/lib/utils/path";

export default function ResetPasswordPage() {
  const t = useTranslations("resetPassword");
  const ta = useTranslations("account");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = extractBasePath(pathname);
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <AccountAuthCard
        title={t("invalidLink")}
        description={t("invalidLinkDescription")}
        footer={
          <Link
            href={`${basePath}/account/forgot-password`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("requestNewLink")}
          </Link>
        }
      />
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== passwordConfirmation) {
      setError(t("passwordsDontMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setSubmitting(true);

    try {
      const result = await resetPassword(token, password, passwordConfirmation);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || t("linkExpired"));
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <AccountAuthCard
        title={t("success")}
        description={t("successDescription")}
      >
        <div className="mb-4 flex justify-center">
          <CircleCheck
            className="size-10 text-store-success"
            aria-hidden="true"
          />
        </div>
        <Button
          size="lg"
          className="w-full"
          onClick={() => router.push(`${basePath}/account`)}
        >
          {t("signIn")}
        </Button>
      </AccountAuthCard>
    );
  }

  return (
    <AccountAuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <Link
          href={`${basePath}/account`}
          className="font-medium text-store-primary hover:text-store-primary-hover"
        >
          {t("backToSignIn")}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AccountPasswordField
          id="password"
          label={t("newPassword")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
          minLength={6}
        />
        <AccountPasswordField
          id="passwordConfirmation"
          label={t("confirmPassword")}
          value={passwordConfirmation}
          onChange={setPasswordConfirmation}
          autoComplete="new-password"
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
          minLength={6}
        />
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full"
        >
          {submitting ? t("resetting") : t("resetPassword")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
