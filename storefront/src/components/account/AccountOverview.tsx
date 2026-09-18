"use client";

import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Heart,
  HelpCircle,
  LogOut,
  MapPin,
  ShoppingBag,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localeDirection } from "@/i18n/locales";
import { ACCOUNT_ORDER_HISTORY_CAPABILITY } from "@/lib/commerce/capabilities";
import { extractBasePath } from "@/lib/utils/path";

const DESTINATIONS = [
  {
    href: "/account/orders",
    key: "orders" as const,
    descriptionKey: "orderHistoryDescription" as const,
    icon: ShoppingBag,
  },
  {
    href: "/account/profile",
    key: "profile" as const,
    descriptionKey: "profileDescription" as const,
    icon: User,
  },
  {
    href: "/account/addresses",
    key: "addresses" as const,
    descriptionKey: "addressesDescription" as const,
    icon: MapPin,
  },
  {
    href: "/account/wishlist",
    key: "wishlist" as const,
    descriptionKey: "wishlistDescription" as const,
    icon: Heart,
  },
  {
    href: "/account/payment-methods",
    key: "paymentMethods" as const,
    descriptionKey: "paymentMethodsDescription" as const,
    icon: CreditCard,
  },
  {
    href: "/policies",
    key: "help" as const,
    descriptionKey: "helpDescription" as const,
    icon: HelpCircle,
  },
];

function displayName(
  user: { first_name?: string | null; last_name?: string | null } | null,
  fallback: string,
) {
  if (!user) return fallback;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return name || fallback;
}

export function AccountOverview() {
  const t = useTranslations("account");
  const to = useTranslations("orders");
  const pathname = usePathname();
  const router = useRouter();
  const basePath = extractBasePath(pathname);
  const { user, logout } = useAuth();
  const rtl = localeDirection(useLocale()) === "rtl";
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await logout();
      router.replace(`${basePath}/account`);
    } catch {
      setSignOutError(t("signOutFailed"));
      setSigningOut(false);
    }
  };

  return (
    <div>
      <header>
        <p className="text-xs font-medium text-store-muted-foreground">
          {t("signedInAs")}
        </p>
        <h1 className="mt-1 break-words text-xl font-bold text-store-foreground">
          {displayName(user, t("myAccount"))}
        </h1>
        {user?.email && (
          <p className="mt-1 break-all text-sm text-store-muted-foreground">
            <bdi>{user.email}</bdi>
          </p>
        )}
      </header>

      {ACCOUNT_ORDER_HISTORY_CAPABILITY !== "live" && (
        <section className="mt-6" aria-labelledby="account-recent-orders">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="account-recent-orders"
              className="text-sm font-semibold text-store-foreground"
            >
              {t("orders")}
            </h2>
            <Link
              href={`${basePath}/account/orders`}
              className="text-sm font-medium text-store-primary hover:text-store-primary-hover"
            >
              {t("orderHistory")}
            </Link>
          </div>
          <AccountGatedNotice
            title={to("lookupUnavailableTitle")}
            body={to("lookupUnavailableBody")}
          />
        </section>
      )}

      <ul className="mt-6 divide-y divide-store-border overflow-hidden rounded-store border border-store-border bg-store-surface sm:grid sm:grid-cols-2 sm:gap-px sm:divide-y-0 sm:bg-store-border">
        {DESTINATIONS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href} className="bg-store-surface">
              <Link
                href={`${basePath}${item.href}`}
                className="flex min-h-11 items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-store-surface-muted"
              >
                <Icon
                  className="size-4 shrink-0 text-store-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-store-foreground">
                    {t(item.key)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-store-muted-foreground">
                    {t(item.descriptionKey)}
                  </span>
                </span>
                <Chevron
                  className="size-3.5 shrink-0 text-store-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 lg:hidden">
        <Button
          variant="outline"
          onClick={handleLogout}
          disabled={signingOut}
          className="h-11 w-full"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {signingOut ? t("signingOut") : t("signOut")}
        </Button>
        {signOutError && (
          <p role="alert" className="mt-2 text-sm text-store-destructive">
            {signOutError}
          </p>
        )}
      </div>
    </div>
  );
}
