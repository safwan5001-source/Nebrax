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
import { cn } from "@/lib/utils";

/** Desktop settings row: label | readable control. Mobile stays stacked. */
const desktopSettingsField =
  "lg:grid lg:grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:gap-y-0 lg:py-5";

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
        {user.email ? (
          <p className="mt-1 hidden text-sm text-store-muted-foreground lg:block">
            <bdi>{user.email}</bdi>
          </p>
        ) : null}
      </header>

      <form onSubmit={handleSubmit} className="mt-4 w-full lg:mt-0">
        {error && (
          <Alert variant="destructive" className="mb-3 lg:mt-5 lg:mb-0">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <p
            role="status"
            className="mb-3 text-sm text-store-foreground lg:mt-5 lg:mb-0"
          >
            {t("profileUpdated")}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-store-border">
          <Field className={desktopSettingsField}>
            <FieldLabel htmlFor="first_name" className="lg:pt-3">
              {t("firstName")}
            </FieldLabel>
            <Input
              type="text"
              id="first_name"
              autoComplete="given-name"
              className="lg:max-w-md"
              value={formData.first_name}
              onChange={(event) =>
                setFormData({ ...formData, first_name: event.target.value })
              }
            />
          </Field>
          <Field className={desktopSettingsField}>
            <FieldLabel htmlFor="last_name" className="lg:pt-3">
              {t("lastName")}
            </FieldLabel>
            <Input
              type="text"
              id="last_name"
              autoComplete="family-name"
              className="lg:max-w-md"
              value={formData.last_name}
              onChange={(event) =>
                setFormData({ ...formData, last_name: event.target.value })
              }
            />
          </Field>
        </div>

        <div className="mt-3 space-y-3 lg:mt-0 lg:space-y-0 lg:divide-y lg:divide-store-border lg:border-t lg:border-store-border">
          <Field className={desktopSettingsField}>
            <FieldLabel htmlFor="email" className="lg:pt-3">
              {t("emailAddress")}
            </FieldLabel>
            <Input
              type="email"
              id="email"
              autoComplete="email"
              required
              className="lg:max-w-md"
              value={formData.email}
              onChange={(event) =>
                setFormData({ ...formData, email: event.target.value })
              }
            />
          </Field>

          <Field className={desktopSettingsField}>
            <FieldLabel htmlFor="phone" className="lg:pt-3">
              {t("phone")}
            </FieldLabel>
            <Input
              type="tel"
              id="phone"
              disabled
              readOnly
              value=""
              className="lg:max-w-md"
            />
            <p className="text-sm leading-relaxed text-store-muted-foreground lg:col-start-2 lg:mt-1.5 lg:max-w-md">
              {t("phoneUnavailable")}
            </p>
          </Field>

          {emailChanged && (
            <div className={desktopSettingsField}>
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
                className="lg:contents"
                controlClassName="lg:max-w-md"
              />
              <p
                id="current_password_help"
                className={cn(
                  "mt-1.5 text-sm leading-relaxed lg:col-start-2 lg:max-w-md lg:mt-0",
                  passwordError
                    ? "text-store-destructive"
                    : "text-store-muted-foreground",
                )}
              >
                {passwordError || t("currentPasswordHelp")}
              </p>
            </div>
          )}

          <div className="pt-1 lg:grid lg:grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)] lg:gap-x-10 lg:py-5">
            <div className="lg:col-start-2">
              <Button type="submit" disabled={saving}>
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
