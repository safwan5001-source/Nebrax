"use client";

import type { LucideIcon } from "lucide-react";
import { Home, LayoutGrid, ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useCart } from "@/contexts/CartContext";
import { cn } from "@/lib/utils";

interface MobileBottomNavProps {
  basePath: string;
}

interface NavItem {
  key: "home" | "shop" | "cart" | "account";
  href: string;
  icon: LucideIcon;
  /** Home matches only its own path; the rest own their whole subtree. */
  exact?: boolean;
  /**
   * Route subtrees this item owns besides its own `href`. Category pages live
   * under `/c`, not under `/products`, but they are the same shopping surface —
   * without this the bar would lose its selected state for the whole of
   * category browsing, which is most of it.
   */
  owns?: string[];
}

function ownsPath(base: string, pathname: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Primary shopping navigation for handheld widths.
 *
 * Every destination is an existing storefront route — there is no wishlist
 * entry because the storefront has no wishlist persistence to back it, and a
 * dead tab would imply a capability the platform does not have.
 */
export function MobileBottomNav({ basePath }: MobileBottomNavProps) {
  const t = useTranslations("header");
  const pathname = usePathname();
  const { itemCount } = useCart();
  const [mounted, setMounted] = useState(false);

  // The badge depends on a client-side cart, so it is withheld until after
  // hydration rather than rendering a count the server could not know.
  useEffect(() => {
    setMounted(true);
  }, []);

  const items: NavItem[] = [
    { key: "home", href: basePath || "/", icon: Home, exact: true },
    {
      key: "shop",
      href: `${basePath}/products`,
      icon: LayoutGrid,
      owns: [`${basePath}/c`],
    },
    { key: "cart", href: `${basePath}/cart`, icon: ShoppingBag },
    { key: "account", href: `${basePath}/account`, icon: User },
  ];

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href || pathname === `${item.href}/`
      : ownsPath(item.href, pathname) ||
        (item.owns ?? []).some((base) => ownsPath(base, pathname));

  return (
    <nav
      aria-label={t("primaryNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-store-border bg-store-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <li key={item.key} className="contents">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-store-bottom-nav flex-col items-center justify-center gap-1.5 px-1 text-[0.625rem] leading-none transition-colors",
                  active
                    ? "font-bold text-store-primary"
                    : "font-medium text-store-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {item.key === "cart" && mounted && itemCount > 0 && (
                    <span className="absolute -top-1.5 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-store-primary px-1 text-[0.625rem] font-medium text-store-primary-foreground tabular-nums">
                      {itemCount}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
