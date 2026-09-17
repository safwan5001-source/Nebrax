import type { Category } from "@spree/sdk";
import { User } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CartButton } from "@/components/layout/CartButton";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { StoreSearch } from "@/components/layout/StoreSearch";
import { Button } from "@/components/ui/button";
import { isWholesaleEnabled } from "@/lib/spree";

const LazyMobileMenu = dynamic(
  () =>
    import("@/components/layout/MobileMenu").then((mod) => ({
      default: mod.MobileMenu,
    })),
  {
    loading: () => (
      <div className="inline-flex items-center justify-center h-10 w-10" />
    ),
  },
);

const LazyRegionPreferences = dynamic(
  () =>
    import("@/components/layout/RegionPreferences").then((mod) => ({
      default: mod.RegionPreferences,
    })),
  {
    loading: () => <div className="size-11" aria-hidden="true" />,
  },
);

interface HeaderProps {
  basePath: string;
  locale: Locale;
  mobileNavigation: ReactNode;
  categoryNavigation: ReactNode;
  storeName: string | null;
}

interface HeaderMobileMenuProps {
  rootCategories: Category[];
  basePath: string;
}

export function HeaderMobileMenu({
  rootCategories,
  basePath,
}: HeaderMobileMenuProps) {
  return (
    <LazyMobileMenu
      rootCategories={rootCategories}
      basePath={basePath}
      wholesaleEnabled={isWholesaleEnabled()}
    />
  );
}

/**
 * The storefront header.
 *
 * The composition changes twice rather than once: below `md` search takes its
 * own full-width row and categories live in the drawer; from `md` search moves
 * inline and the category rail appears; from `lg` the drawer is retired and the
 * region and wholesale controls surface directly in the row.
 *
 * The whole banner is what sticks. A sticky inner row would only be able to
 * travel inside this element's own box and would disappear on the first scroll,
 * so search, cart and menu all stay reachable together — 56px of pinned chrome
 * on a phone, where the bottom navigation carries the rest.
 */
export async function Header({
  basePath,
  locale,
  mobileNavigation,
  categoryNavigation,
  storeName,
}: HeaderProps) {
  const t = await getTranslations({ locale, namespace: "header" });
  const footer = await getTranslations({ locale, namespace: "footer" });
  const wholesaleEnabled = isWholesaleEnabled();
  const displayName = storeName?.trim() || footer("shop");

  return (
    <header className="sticky top-0 z-40 bg-store-surface">
      <div className="border-b border-store-border">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-4 focus:z-50 focus:rounded-md focus:border focus:border-store-border focus:bg-store-surface focus:px-3 focus:py-2 focus:shadow-sm focus:text-sm focus:font-medium focus:text-store-foreground"
        >
          {t("skipToContent")}
        </a>
        <StoreContainer>
          <div className="flex h-store-header items-center gap-2 md:h-store-header-lg md:gap-6">
            <div className="flex min-w-0 items-center gap-1">
              <div className="-ms-2 lg:hidden">{mobileNavigation}</div>
              <Link
                href={basePath || "/"}
                className="min-w-0 truncate text-lg font-semibold text-store-foreground md:text-xl"
              >
                <bdi>{displayName}</bdi>
              </Link>
            </div>

            <div className="hidden min-w-0 flex-1 md:block">
              <StoreSearch basePath={basePath} />
            </div>

            <div className="ms-auto flex items-center gap-0.5 md:ms-0 md:gap-1">
              {wholesaleEnabled && (
                <Link
                  href={`${basePath}/wholesale`}
                  className="hidden whitespace-nowrap px-2 py-1.5 text-sm text-store-muted-foreground transition-colors hover:text-store-foreground lg:block"
                >
                  {t("wholesale")}
                </Link>
              )}
              <div className="hidden lg:flex lg:items-center">
                <LazyRegionPreferences variant="header" />
              </div>
              <div className="hidden md:block">
                <Button variant="ghost" size="icon-lg" asChild>
                  <Link href={`${basePath}/account`} aria-label={t("account")}>
                    <User className="size-5" />
                  </Link>
                </Button>
              </div>
              <CartButton />
            </div>
          </div>
        </StoreContainer>
      </div>

      <div className="border-b border-store-border md:hidden">
        <StoreContainer className="py-2">
          <StoreSearch basePath={basePath} />
        </StoreContainer>
      </div>

      {categoryNavigation}
    </header>
  );
}
