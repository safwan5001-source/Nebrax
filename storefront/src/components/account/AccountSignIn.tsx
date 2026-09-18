"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { resolveAccountRedirect } from "@/lib/utils/account-redirect";
import { extractBasePath } from "@/lib/utils/path";

export function AccountSignIn() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("account");
  const { login } = useAuth();

  const redirectUrl = resolveAccountRedirect(
    searchParams.get("redirect"),
    basePath,
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const result = await login(email, password);
    if (result.success) {
      if (redirectUrl) router.push(redirectUrl);
    } else {
      setError(result.error || t("invalidCredentials"));
    }
    setLoading(false);
  };

  return (
    <AccountAuthCard
      title={t("myAccount")}
      description={t("signInDescription")}
      footer={
        <p>
          {t("dontHaveAccount")}{" "}
          <Link
            href={`${basePath}/account/register`}
            className="font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("signUp")}
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

        <AccountPasswordField
          id="current-password"
          label={t("password")}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
        />

        <div className="flex justify-end">
          <Link
            href={`${basePath}/account/forgot-password`}
            className="text-sm font-medium text-store-primary hover:text-store-primary-hover"
          >
            {t("forgotPassword")}
          </Link>
        </div>

        <Button type="submit" disabled={loading} size="lg" className="w-full">
          {loading ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </AccountAuthCard>
  );
}
