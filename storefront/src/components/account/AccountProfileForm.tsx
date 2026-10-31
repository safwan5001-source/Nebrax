"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountPasswordField } from "@/components/account/AccountPasswordField";
import { AccountSessionsPanel } from "@/components/account/AccountSessionsPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { User } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { joinDisplayName } from "@/lib/commerce/account";
import { accountErrorMessage } from "@/lib/commerce/account-error-message";
import { changePassword, updateProfile } from "@/lib/data/customer";

/** E.164 as the API requires: `+` then 8–15 digits (first non-zero). Latin digits only — the field is `dir="ltr"`. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Arabic-Indic / Persian digits → 0–9, so a phone typed on an Arabic keyboard is still the number the API expects. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function AccountProfileForm({ user }: { user: User }) {
  const t = useTranslations("profile");
  const ta = useTranslations("account");
  const tr = useTranslations("retailAccount");
  const te = useTranslations("accountErrors");
  const { refreshUser } = useAuth();

  const [name, setName] = useState(
    joinDisplayName(user.first_name ?? undefined, user.last_name ?? undefined),
  );
  const [phone, setPhone] = useState(user.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    const trimmedName = name.trim();
    const normalizedPhone = latinDigits(phone).replace(/[\s-]/g, "");
    if (trimmedName === "") {
      setError(tr("nameRequired"));
      return;
    }
    if (normalizedPhone !== "" && !E164.test(normalizedPhone)) {
      setError(tr("phoneInvalid"));
      return;
    }

    setSaving(true);
    const result = await updateProfile({
      displayName: trimmedName,
      phone: normalizedPhone === "" ? null : normalizedPhone,
    });
    if (result.kind === "ok") {
      setSuccess(true);
      await refreshUser();
    } else {
      setError(
        result.kind === "invalid"
          ? accountErrorMessage(
              result.code,
              (code) => te(code),
              t("failedToUpdate"),
            )
          : t("failedToUpdate"),
      );
    }
    setSaving(false);
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPwError(null);
    setPwDone(false);
    if (newPassword.length < 8) {
      setPwError(tr("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError(tr("passwordsDontMatch"));
      return;
    }
    setPwSaving(true);
    const result = await changePassword({ currentPassword, newPassword });
    if (result.kind === "ok") {
      setPwDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPwError(
        result.kind === "invalid"
          ? tr("passwordChangeInvalid")
          : t("failedToUpdate"),
      );
    }
    setPwSaving(false);
  };

  return (
    <div className="space-y-10">
      <form
        onSubmit={saveProfile}
        className="space-y-4"
        aria-labelledby="profile-heading"
      >
        <h1
          id="profile-heading"
          className="text-xl font-bold text-store-foreground lg:text-2xl"
        >
          {ta("profile")}
        </h1>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert role="status" data-testid="profile-saved">
            <CircleCheck />
            <AlertDescription>{t("profileUpdated")}</AlertDescription>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="profile-name">{tr("fullName")}</FieldLabel>
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-email">{ta("email")}</FieldLabel>
          <Input
            id="profile-email"
            type="email"
            value={user.email}
            readOnly
            dir="ltr"
            aria-describedby="profile-email-help"
          />
          <p
            id="profile-email-help"
            className="mt-1 text-xs text-store-muted-foreground"
          >
            {tr("emailReadOnly")}
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-phone">{tr("phone")}</FieldLabel>
          <Input
            id="profile-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(latinDigits(event.target.value))}
            placeholder="+9665XXXXXXXX"
            aria-describedby="profile-phone-help"
          />
          <p
            id="profile-phone-help"
            className="mt-1 text-xs text-store-muted-foreground"
          >
            {tr("phoneHelp")}
          </p>
        </Field>
        <Button
          type="submit"
          size="lg"
          disabled={saving}
          className="w-full sm:w-auto"
        >
          {saving ? t("saving") : t("saveChanges")}
        </Button>
      </form>

      <form
        onSubmit={savePassword}
        className="space-y-4 border-t border-store-border pt-8"
        aria-labelledby="password-heading"
      >
        <h2
          id="password-heading"
          className="text-base font-semibold text-store-foreground"
        >
          {tr("changePasswordTitle")}
        </h2>
        <p className="text-sm text-store-muted-foreground">
          {tr("changePasswordBody")}
        </p>
        {pwError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{pwError}</AlertDescription>
          </Alert>
        )}
        {pwDone && (
          <Alert role="status" data-testid="password-changed">
            <CircleCheck />
            <AlertDescription>{tr("passwordChanged")}</AlertDescription>
          </Alert>
        )}
        <AccountPasswordField
          id="current-password"
          label={tr("currentPassword")}
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
        />
        <AccountPasswordField
          id="new-password"
          label={tr("newPassword")}
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
          minLength={8}
        />
        <AccountPasswordField
          id="confirm-new-password"
          label={tr("confirmNewPassword")}
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          showLabel={ta("showPassword")}
          hideLabel={ta("hidePassword")}
          minLength={8}
        />
        <Button
          type="submit"
          size="lg"
          variant="outline"
          disabled={pwSaving}
          className="w-full sm:w-auto"
        >
          {pwSaving ? t("saving") : tr("changePasswordAction")}
        </Button>
      </form>

      <AccountSessionsPanel />
    </div>
  );
}
