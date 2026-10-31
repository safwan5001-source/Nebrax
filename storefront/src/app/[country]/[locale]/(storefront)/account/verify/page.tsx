"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountsGate } from "@/components/account/AccountsGate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resendVerification, verifyEmail } from "@/lib/data/customer";
import { extractBasePath } from "@/lib/utils/path";

export default function VerifyEmailPage() {
  return (
    <AccountsGate>
      <VerifyEmail />
    </AccountsGate>
  );
}

/**
 * E-mail verification. With `?token=` the e-mailed single-use link is consumed (one generic failure — the API never says
 * whether the link was unknown, expired or used). Without a token, the shopper may ask for a fresh link; the answer is
 * neutral whatever the address is.
 */
function VerifyEmail() {
  const t = useTranslations("retailAccount");
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const token = useSearchParams().get("token");

  return token ? (
    <ConsumeToken token={token} basePath={basePath} />
  ) : (
    <ResendForm basePath={basePath} title={t("resendTitle")} />
  );
}

function ConsumeToken({
  token,
  basePath,
}: {
  token: string;
  basePath: string;
}) {
  const t = useTranslations("retailAccount");
  const [state, setState] = useState<"working" | "ok" | "failed">("working");
  // a single-use token: guard against the dev double-invoke so the real attempt is not "used" twice
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verifyEmail(token).then((result) =>
      setState(result.success ? "ok" : "failed"),
    );
  }, [token]);

  if (state === "working") {
    return (
      <AccountAuthCard title={t("verifyingTitle")}>
        <p role="status" className="text-sm text-store-muted-foreground">
          {t("verifying")}
        </p>
      </AccountAuthCard>
    );
  }

  if (state === "ok") {
    return (
      <AccountAuthCard
        title={t("verifiedTitle")}
        description={t("verifiedBody")}
      >
        <div data-testid="email-verified">
          <CircleCheck
            className="mb-4 size-10 text-store-success"
            aria-hidden="true"
          />
          <Button size="lg" className="w-full" asChild>
            <Link href={`${basePath}/account`}>{t("signInNow")}</Link>
          </Button>
        </div>
      </AccountAuthCard>
    );
  }

  return (
    <ResendForm
      basePath={basePath}
      title={t("verifyFailedTitle")}
      description={t("verifyFailedBody")}
    />
  );
}

function ResendForm({
  basePath,
  title,
  description,
}: {
  basePath: string;
  title: string;
  description?: string;
}) {
  const t = useTranslations("retailAccount");
  const te = useTranslations("accountErrors");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await resendVerification(email, basePath);
      if (result.success) setSent(true);
      else
        setError(
          result.code === "rate_limited"
            ? te("rate_limited")
            : te("request_failed"),
        );
    } catch {
      setError(te("request_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccountAuthCard
      title={title}
      description={description ?? t("resendBody")}
      footer={
        <Link
          href={`${basePath}/account`}
          className="font-medium text-store-primary hover:text-store-primary-hover"
        >
          {t("backToSignIn")}
        </Link>
      }
    >
      {sent ? (
        <p
          role="status"
          data-testid="verification-resent"
          className="text-sm text-store-muted-foreground"
        >
          {t("resendNeutral")}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="verify-email">{t("email")}</FieldLabel>
            <Input
              id="verify-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
            />
          </Field>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? t("sending") : t("sendVerification")}
          </Button>
        </form>
      )}
    </AccountAuthCard>
  );
}
