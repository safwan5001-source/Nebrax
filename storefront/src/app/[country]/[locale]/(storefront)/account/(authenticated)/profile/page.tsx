"use client";

import { useTranslations } from "next-intl";
import { AccountAuthUnavailable } from "@/components/account/AccountAuthUnavailable";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { useAuth } from "@/contexts/AuthContext";
import { ACCOUNT_AUTH_CAPABILITY } from "@/lib/commerce/capabilities";

export default function ProfilePage() {
  // SPREE-X1: profile edits have no backend while authentication is gated.
  if (ACCOUNT_AUTH_CAPABILITY !== "live") return <AccountAuthUnavailable />;
  return <ProfileContent />;
}

function ProfileContent() {
  const t = useTranslations("profile");
  const { user } = useAuth();

  if (!user) {
    return (
      <p className="py-12 text-center text-sm text-store-muted-foreground">
        {t("loadingProfile")}
      </p>
    );
  }

  return <AccountProfileForm key={user.id} user={user} />;
}
