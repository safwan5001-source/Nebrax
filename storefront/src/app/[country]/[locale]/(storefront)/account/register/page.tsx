"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { PolicyConsent } from "@/components/policy/PolicyConsent";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { extractBasePath } from "@/lib/utils/path";

export default function RegisterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("register");
  const ta = useTranslations("account");
  const { register, isAuthenticated, loading: authLoading } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policyConsent, setPolicyConsent] = useState(false);
  const [policyError, setPolicyError] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push(`${basePath}/account`);
    }
  }, [authLoading, isAuthenticated, router, basePath]);
  if (authLoading || isAuthenticated) {
    return null;
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

    if (!policyConsent) {
      setPolicyError(true);
      setError(ta("policyConsentRequired"));
      document
        .getElementById("policy-consent")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("policy-consent")?.focus();
      return;
    }

    setSubmitting(true);

    try {
      const result = await register({
        email,
        password,
        password_confirmation: passwordConfirmation,
        ...(firstName && { first_name: firstName }),
        ...(lastName && { last_name: lastName }),
      });
      if (result.success) {
        router.push(`${basePath}/account`);
      } else {
        setError(result.error || t("registrationFailed"));
      }
    } catch {
      setError(t("unexpectedError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AccountAuthCard
      title={t("createAccount")}
      description={t("signUpDescription")}
      footer={
        <p>
          {t("alreadyHaveAccount")}{" "}
          <Link
            href={`${basePath}/account`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("signIn")}
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="firstName">{t("firstName")}</FieldLabel>
            <Input
              type="text"
              id="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              placeholder={t("firstNamePlaceholder")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lastName">{t("lastName")}</FieldLabel>
            <Input
              type="text"
              id="lastName"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              placeholder={t("lastNamePlaceholder")}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="email">{ta("email")}</FieldLabel>
          <Input
            type="email"
            id="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder={t("emailPlaceholder")}
          />
        </Field>

        <AccountPasswordField
          id="password"
          label={ta("password")}
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

        <PolicyConsent
          checked={policyConsent}
          onCheckedChange={(checked) => {
            setPolicyConsent(checked);
            if (checked) setPolicyError(false);
          }}
          error={policyError}
        />

        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          className="w-full"
        >
          {submitting ? t("creatingAccount") : t("createAccount")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
