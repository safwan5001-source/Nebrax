"use client";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { User } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { updateCustomer } from "@/lib/data/customer";

export function AccountProfileForm({ user }: { user: User }) {
  const t = useTranslations("profile");
  const ta = useTranslations("account");
  const { refreshUser } = useAuth();

  const [formData, setFormData] = useState({
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    email: user.email || "",
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const emailChanged = formData.email.trim() !== user.email;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPasswordError(null);
    setSuccess(false);

    if (!formData.email.trim()) {
      setError(t("validationEmail"));
      return;
    }
    if (emailChanged && !currentPassword) {
      setPasswordError(t("currentPasswordHelp"));
      return;
    }

    setSaving(true);
    const result = await updateCustomer({
      ...formData,
      ...(emailChanged && { current_password: currentPassword }),
    });

    if (result.success) {
      setSuccess(true);
      setCurrentPassword("");
      await refreshUser();
    } else {
      const message = result.error || t("failedToUpdate");
      if (emailChanged && /current password/i.test(message)) {
        setPasswordError(message);
      } else {
        setError(message);
      }
    }
    setSaving(false);
  };

  return (
    <div>
      <header className="lg:border-b lg:border-store-border lg:pb-5">
        <h1 className="text-xl font-bold text-store-foreground lg:text-2xl">
          {t("profile")}
        </h1>
      </header>

      <form
        onSubmit={handleSubmit}
        className="mt-4 w-full space-y-3 lg:mt-8 lg:space-y-6"
      >
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <p role="status" className="text-sm text-store-foreground">
            {t("profileUpdated")}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-x-8 lg:gap-y-6">
          <Field className="lg:gap-2.5">
            <FieldLabel htmlFor="first_name">{t("firstName")}</FieldLabel>
            <Input
              type="text"
              id="first_name"
              autoComplete="given-name"
              value={formData.first_name}
              onChange={(event) =>
                setFormData({ ...formData, first_name: event.target.value })
              }
            />
          </Field>
          <Field className="lg:gap-2.5">
            <FieldLabel htmlFor="last_name">{t("lastName")}</FieldLabel>
            <Input
              type="text"
              id="last_name"
              autoComplete="family-name"
              value={formData.last_name}
              onChange={(event) =>
                setFormData({ ...formData, last_name: event.target.value })
              }
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-8 lg:gap-y-6">
          <Field className="lg:gap-2.5">
            <FieldLabel htmlFor="email">{t("emailAddress")}</FieldLabel>
            <Input
              type="email"
              id="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={(event) =>
                setFormData({ ...formData, email: event.target.value })
              }
            />
          </Field>

          <Field className="lg:gap-2.5">
            <FieldLabel htmlFor="phone">{t("phone")}</FieldLabel>
            <Input type="tel" id="phone" disabled readOnly value="" />
            <p className="text-sm leading-relaxed text-store-muted-foreground">
              {t("phoneUnavailable")}
            </p>
          </Field>
        </div>

        {emailChanged && (
          <div className="lg:max-w-xl">
            <AccountPasswordField
              id="current_password"
              label={t("currentPassword")}
              value={currentPassword}
              onChange={(value) => {
                setCurrentPassword(value);
                if (passwordError) setPasswordError(null);
              }}
              autoComplete="current-password"
              showLabel={ta("showPassword")}
              hideLabel={ta("hidePassword")}
              describedBy="current_password_help"
              invalid={Boolean(passwordError)}
            />
            <p
              id="current_password_help"
              className={`mt-1.5 text-sm leading-relaxed ${
                passwordError
                  ? "text-store-destructive"
                  : "text-store-muted-foreground"
              }`}
            >
              {passwordError || t("currentPasswordHelp")}
            </p>
          </div>
        )}

        <div className="pt-1 lg:border-t lg:border-store-border lg:pt-5">
          <Button type="submit" disabled={saving}>
            {saving ? t("saving") : t("saveChanges")}
          </Button>
        </div>
      </form>
    </div>
  );
}
