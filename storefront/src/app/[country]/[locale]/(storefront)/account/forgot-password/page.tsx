"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/data/customer";
import { extractBasePath } from "@/lib/utils/path";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgotPassword");
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const origin = window.location.origin;
      const redirectUrl = `${origin}${basePath}/account/reset-password`;
      const result = await requestPasswordReset(email, redirectUrl);
      if (result?.message) {
        setSubmitted(true);
      } else {
        setError(t("genericError"));
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AccountAuthCard
        title={t("checkYourEmail")}
        description={t.rich("resetEmailSent", {
          email,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        footer={
          <Link
            href={`${basePath}/account`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("backToSignIn")}
          </Link>
        }
      >
        <div className="flex items-start gap-3 text-sm text-store-muted-foreground">
          <CircleCheck
            className="mt-0.5 size-5 shrink-0 text-store-success"
            aria-hidden="true"
          />
          <p>{t("linkExpiry")}</p>
        </div>
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => {
            setSubmitted(false);
            setEmail("");
          }}
        >
          {t("tryDifferentEmail")}
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
        <Field>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
          <Input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="you@example.com"
          />
        </Field>
        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full"
        >
          {submitting ? t("sending") : t("sendResetLink")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
