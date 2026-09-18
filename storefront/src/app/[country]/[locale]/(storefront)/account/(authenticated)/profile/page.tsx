"use client";

import { useTranslations } from "next-intl";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { useAuth } from "@/contexts/AuthContext";

export default function ProfilePage() {
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
