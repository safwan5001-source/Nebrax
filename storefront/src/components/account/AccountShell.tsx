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
import {
  ACCOUNT_NAV_ITEMS,
  isAccountNavActive,
} from "@/components/account/account-nav";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localeDirection } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { extractBasePath } from "@/lib/utils/path";

const ICONS = {
  overview: User,
  orders: ShoppingBag,
  profile: User,
  addresses: MapPin,
  wishlist: Heart,
  paymentMethods: CreditCard,
} as const;

function displayName(
  user: { first_name?: string | null; last_name?: string | null } | null,
  fallback: string,
) {
  if (!user) return fallback;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return name || fallback;
}

export function AccountShell({
  children,
  pathnameOverride,
}: {
  children: React.ReactNode;
  /** Preview harness only — live routes leave this unset. */
  pathnameOverride?: string;
}) {
  const t = useTranslations("account");
  const livePathname = usePathname();
  const pathname = pathnameOverride ?? livePathname;
  const router = useRouter();
  const basePath = extractBasePath(pathname);
  const { user, logout } = useAuth();
  const rtl = localeDirection(useLocale()) === "rtl";
  const BackChevron = rtl ? ChevronRight : ChevronLeft;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onOverview = isAccountNavActive(pathname, basePath, "/account", true);

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
    <StoreContainer className="py-5 sm:py-7 lg:py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8 xl:gap-12">
        <aside className="hidden lg:block lg:w-56 lg:shrink-0 xl:w-60">
          <div className="overflow-hidden rounded-store border border-store-border bg-store-surface lg:sticky lg:top-24">
            <div className="border-b border-store-border px-5 py-4">
              <p className="truncate font-medium text-store-foreground">
                {displayName(user, t("myAccount"))}
              </p>
              {user?.email && (
                <p className="mt-0.5 truncate text-sm text-store-muted-foreground">
                  <bdi>{user.email}</bdi>
                </p>
              )}
            </div>
            <nav aria-label={t("myAccount")} className="p-2">
              <ul className="space-y-0.5">
                {ACCOUNT_NAV_ITEMS.map((item) => {
                  const href = `${basePath}${item.href}`;
                  const active = isAccountNavActive(
                    pathname,
                    basePath,
                    item.href,
                    "exact" in item ? item.exact : false,
                  );
                  const Icon = ICONS[item.key];
                  return (
                    <li key={item.href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-store px-3 text-sm font-medium transition-colors",
                          active
                            ? "bg-store-primary-soft text-store-primary"
                            : "text-store-foreground hover:bg-store-surface-muted",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{t(item.key)}</span>
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href={`${basePath}/policies`}
                    className="flex min-h-11 items-center gap-3 rounded-store px-3 text-sm font-medium text-store-foreground hover:bg-store-surface-muted"
                  >
                    <HelpCircle
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t("help")}
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="border-t border-store-border p-2">
              <Button
                variant="ghost"
                onClick={handleLogout}
                disabled={signingOut}
                className="h-11 w-full justify-start gap-3 text-store-foreground"
              >
                <LogOut className="size-4" aria-hidden="true" />
                {signingOut ? t("signingOut") : t("signOut")}
              </Button>
              {signOutError && (
                <p
                  role="alert"
                  className="px-3 pb-2 text-xs text-store-destructive"
                >
                  {signOutError}
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {!onOverview && (
            <Link
              href={`${basePath}/account`}
              className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-store-muted-foreground hover:text-store-foreground lg:hidden"
            >
              <BackChevron className="size-4" aria-hidden="true" />
              {t("backToAccount")}
            </Link>
          )}
          {children}
        </div>
      </div>
    </StoreContainer>
  );
}
