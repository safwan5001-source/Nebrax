import type { Category } from "@spree/sdk";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import type { StoreNavCategory } from "@/components/layout/CategoryNav";
import { CategoryNav } from "@/components/layout/CategoryNav";
import { Footer, FooterCategoryLinks } from "@/components/layout/Footer";
import { Header, HeaderMobileMenu } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { StoreWhatsApp } from "@/components/layout/StoreWhatsApp";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { getCategories } from "@/lib/data/categories";
import {
  publishedExtraNav,
  publishedLogoUrl,
  publishedSocialLinks,
  publishedStoreName,
  publishedThemeStyle,
  publishedWhatsAppHref,
} from "@/lib/presentation/public";
import {
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  sanitizeExternalUrl,
} from "@/lib/presentation/urls";

interface StorefrontLayoutProps {
  children: React.ReactNode;
  params: Promise<{ country: string; locale: string }>;
}

interface StorefrontNavigationProps {
  basePath: string;
  country: string;
  locale: string;
}

const EMPTY_CATEGORIES: Category[] = [];

function MobileNavigationFallback() {
  return (
    <div
      aria-hidden="true"
      className="size-10 rounded-md bg-store-surface-muted animate-pulse motion-reduce:animate-none"
    />
  );
}

/**
 * Reserves the category rail's row so the page below it does not jump when the
 * categories resolve. It is only rendered where the rail itself is visible, and
 * it matches the resolved band's height and surface for every outcome —
 * see `StorefrontCategoryNavigation`.
 */
function CategoryNavigationFallback() {
  return (
    <div
      aria-hidden="true"
      className="hidden h-store-nav border-b border-store-border bg-store-surface-muted md:block"
    />
  );
}

function FooterCategoryLinksFallback() {
  return (
    <li aria-hidden="true">
      <span className="block h-4 w-24 rounded bg-store-footer-border animate-pulse motion-reduce:animate-none" />
    </li>
  );
}

/**
 * Navigation categories are optional chrome, so defer their first load until
 * there is a real request instead of making every prerendered page contact the
 * Store API. Primitive arguments let React deduplicate category navigation
 * consumers within the request; successful responses keep using the persistent
 * cache in getCategories.
 */
const getRootCategories = cache(async (country: string, locale: string) => {
  await connection();

  return getCategories(
    {
      depth_eq: 0,
      expand: ["children.children"],
    },
    { country, locale },
  )
    .then((res) => res.data)
    .catch((error) => {
      console.error("StorefrontLayout: failed to load categories", error);
      return EMPTY_CATEGORIES;
    });
});

/**
 * Narrows an authoritative category to the fields the rail renders. The rail is
 * a view over the catalogue, so nothing here may add to or reinterpret it.
 */
function toNavCategories(categories: Category[]): StoreNavCategory[] {
  return categories.map((category) => ({
    id: String(category.id),
    name: category.name,
    permalink: category.permalink,
  }));
}

async function StorefrontMobileNavigation({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  return (
    <HeaderMobileMenu rootCategories={rootCategories} basePath={basePath} />
  );
}

async function StorefrontCategoryNavigation({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  // Rendered whatever the catalogue returns, including nothing. The rail always
  // carries its "all products" entry, so an empty or failed category response
  // still resolves to a band of the same height as the fallback above — where
  // collapsing it to null would drop that reserved row and shift the whole page
  // up, which is the jump the fallback exists to prevent.
  return (
    <div className="hidden md:block">
      <CategoryNav
        categories={toNavCategories(rootCategories)}
        basePath={basePath}
      />
    </div>
  );
}

async function StorefrontFooterCategoryLinks({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  return (
    <FooterCategoryLinks rootCategories={rootCategories} basePath={basePath} />
  );
}

export default async function StorefrontLayout({
  children,
  params,
}: StorefrontLayoutProps) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;
  const identity = await fetchStorefrontConfig().catch(() => null);
  const presentation = identity?.presentation ?? null;
  const liveName = identity?.name?.trim() ? identity.name : null;
  const footerMessages = await getTranslations({
    locale: locale as Locale,
    namespace: "footer",
  });
  const displayName = publishedStoreName(
    presentation,
    liveName,
    footerMessages("shop"),
  );
  const themeStyle = publishedThemeStyle(presentation);
  const compact = presentation?.header.style === "compact";
  const logoUrl = publishedLogoUrl(presentation, compact);
  const extraLinks = publishedExtraNav(presentation, basePath);
  const showCategoryNav = presentation
    ? presentation.header.showCategoryNav
    : true;
  const floatingWhatsApp = publishedWhatsAppHref(presentation, "floating");
  const footerWhatsApp = publishedWhatsAppHref(presentation, "footer");
  const ios = presentation?.apps.showFooterLinks
    ? sanitizeExternalUrl(presentation.apps.iosUrl)
    : null;
  const android = presentation?.apps.showFooterLinks
    ? sanitizeExternalUrl(presentation.apps.androidUrl)
    : null;
  const appLinks = [
    ios && isSafeAppStoreUrl(ios)
      ? { id: "app-ios", label: "App Store", href: ios }
      : null,
    android && isSafePlayStoreUrl(android)
      ? { id: "app-android", label: "Google Play", href: android }
      : null,
  ].filter((item): item is { id: string; label: string; href: string } =>
    Boolean(item),
  );

  const chrome = (
    <>
      <Header
        basePath={basePath}
        locale={locale as Locale}
        storeName={displayName}
        logoUrl={logoUrl}
        showSearch={presentation ? presentation.header.showSearch : true}
        showAccount={presentation ? presentation.header.showAccount : true}
        showCart={presentation ? presentation.header.showCart : true}
        compact={compact}
        extraLinks={extraLinks}
        mobileNavigation={
          <Suspense fallback={<MobileNavigationFallback />}>
            <StorefrontMobileNavigation
              basePath={basePath}
              country={country}
              locale={locale}
            />
          </Suspense>
        }
        categoryNavigation={
          showCategoryNav ? (
            <Suspense fallback={<CategoryNavigationFallback />}>
              <StorefrontCategoryNavigation
                basePath={basePath}
                country={country}
                locale={locale}
              />
            </Suspense>
          ) : null
        }
      />
      {/*
        `scroll-margin-top` keeps the skip link's landing point clear of the
        sticky banner; a bare `#main-content` jump would put the first content
        behind the very header the shopper skipped.
      */}
      <main
        id="main-content"
        className="flex-1 scroll-mt-(--store-header-offset)"
      >
        {children}
      </main>
      <Footer
        basePath={basePath}
        locale={locale as Locale}
        storeName={displayName}
        logoUrl={logoUrl}
        showLogo={presentation ? presentation.footer.showLogo : true}
        tagline={presentation?.footer.tagline ?? ""}
        copyright={presentation?.footer.copyright ?? ""}
        contact={presentation?.contact ?? null}
        socialLinks={publishedSocialLinks(presentation)}
        whatsappHref={footerWhatsApp}
        appLinks={appLinks}
        merchantCr={presentation?.verification.crNumber ?? ""}
        merchantLicense={presentation?.verification.licenseNumber ?? ""}
        categoryLinks={
          <Suspense fallback={<FooterCategoryLinksFallback />}>
            <StorefrontFooterCategoryLinks
              basePath={basePath}
              country={country}
              locale={locale}
            />
          </Suspense>
        }
      />
      {/* Keeps the end of the page clear of the fixed bottom navigation. */}
      <div
        aria-hidden="true"
        className="h-[calc(var(--store-bottom-nav-height)+env(safe-area-inset-bottom))] shrink-0 md:hidden"
      />
      <MobileBottomNav basePath={basePath} />
      {floatingWhatsApp ? (
        <StoreWhatsApp
          href={floatingWhatsApp}
          label={footerMessages("whatsappAria")}
        />
      ) : null}
    </>
  );

  if (!themeStyle) {
    return chrome;
  }

  return (
    <div
      data-published-theme=""
      className="flex min-h-screen flex-1 flex-col"
      style={themeStyle}
    >
      {chrome}
    </div>
  );
}
