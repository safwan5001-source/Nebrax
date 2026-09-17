import type { Category } from "@spree/sdk";
import { User } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CartButton } from "@/components/layout/CartButton";
import { StoreBrand } from "@/components/layout/StoreBrand";
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
    loading: () => <div className="h-4 w-20" aria-hidden="true" />,
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
 * Three bands from `md` up, matching the approved baseline's desktop anatomy: a
 * slim utility strip carrying region, language and currency; the identity row
 * with search and the shopper actions; and the category rail. Below `md` the
 * utility strip and the rail fold away, the identity row compacts to 54px with
 * the brand centred, and search wraps onto a second line of the same band.
 *
 * That wrap is why the identity band is one grid rather than two stacked rows:
 * a second `StoreSearch` would own a second query and a second suggestion list,
 * so crossing `md` mid-search — a tablet rotation — would drop the shopper onto
 * a blank field. One instance moves between placements instead.
 *
 * The whole banner is what sticks. A sticky inner row could only travel inside
 * this element's own box and would disappear on the first scroll, so search,
 * cart and menu stay reachable together.
 *
 * Two actions in the reference are deliberately absent. Wishlist has no
 * persistence behind it, and the cart total has no field on the cart context —
 * inventing either would put a promise in the chrome that the platform cannot
 * keep.
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
  const homeHref = basePath || "/";

  return (
    <header className="sticky top-0 z-40 bg-store-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-4 focus:z-50 focus:rounded-store focus:border focus:border-store-border focus:bg-store-surface focus:px-3 focus:py-2 focus:shadow-sm focus:text-sm focus:font-medium focus:text-store-foreground"
      >
        {t("skipToContent")}
      </a>

      <div className="hidden border-b border-store-border bg-store-surface-muted md:block">
        <StoreContainer>
          <div className="flex h-store-utility items-center justify-end">
            <LazyRegionPreferences variant="utility" />
          </div>
        </StoreContainer>
      </div>

      <div className="border-b border-store-border">
        <StoreContainer>
          {/*
            A three-column grid centres the brand between the menu and the cart
            on handhelds without absolute positioning, and mirrors for free in
            RTL. Search sits on a second grid line there and moves into the row
            itself from `md`, where the same children lay out as a flex line.
          */}
          <div className="grid grid-cols-[1fr_auto_1fr] grid-rows-[var(--store-header-height)_auto] items-center gap-x-2 gap-y-1 md:flex md:h-store-header-lg md:grid-rows-none md:gap-6">
            <div className="-ms-2 justify-self-start lg:hidden">
              {mobileNavigation}
            </div>

            <StoreBrand
              href={homeHref}
              name={displayName}
              size="md"
              className="justify-self-center md:justify-self-start"
            />

            <div className="order-last col-span-3 min-w-0 pb-2.5 md:order-none md:col-span-1 md:flex-1 md:pb-0">
              <StoreSearch
                basePath={basePath}
                className="md:max-w-2xl"
                withSubmit
              />
            </div>

            <div className="flex items-center justify-self-end gap-1 md:ms-auto md:gap-2">
              {wholesaleEnabled && (
                <Link
                  href={`${basePath}/wholesale`}
                  className="hidden whitespace-nowrap px-2 py-1.5 text-sm text-store-muted-foreground transition-colors hover:text-store-foreground lg:block"
                >
                  {t("wholesale")}
                </Link>
              )}
              <div className="hidden md:block">
                <Button variant="ghost" size="icon-lg" asChild>
                  <Link href={`${basePath}/account`} aria-label={t("account")}>
                    <User className="size-5" />
                  </Link>
                </Button>
              </div>
              <CartButton variant="icon" className="md:hidden" />
              <CartButton variant="action" className="hidden md:inline-flex" />
            </div>
          </div>
        </StoreContainer>
      </div>

      {categoryNavigation}
    </header>
  );
}
