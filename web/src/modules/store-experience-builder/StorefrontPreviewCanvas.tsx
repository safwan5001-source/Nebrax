"use client";

import {
  ANNOUNCEMENT_PREVIEW_HEIGHT,
  AnnouncementPreview,
  announcementBarVisible,
} from "./AnnouncementPreview";
import { Eye, Home, LayoutGrid, Search, ShoppingBag, User } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { OfficialStoreBadge } from "./OfficialStoreBadge";
import { ContactDetail, contactDetailText } from "./ContactDetail";
import { IdentityDetail } from "./IdentityDetail";
import {
  isOfficialSocialNetwork,
  OfficialSocialMark,
  officialSocialLinkClassName,
} from "./OfficialSocialMark";
import { StoreBrand, storeContainerClassName } from "./StoreBrand";
import {
  isGatedHomeSection,
  previewStoreName,
  type StorefrontPresentationConfig,
} from "./presentation/config";
import type { CategoryPageRegionKey, PageRegionInstance, PageType, ProductPageRegionKey } from "./presentation/page-regions";
import type { WorkspaceProductDetail } from "@/modules/commerce-workspace/workspace-products";
import type { WorkspaceCategoryDetail } from "@/modules/commerce-workspace/workspace-categories";
import { displayLocale } from "@/lib/formatting";
import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import {
  formatOfferMoney,
  isDiscountBadgeVisible,
  offerDiscountBadgeText,
  offerDisplayName,
} from "./offers-display";
import { PageIcon, pageLabelKey } from "./PageNavigatorPanel";
import {
  fontPresetFamilyStack,
  pageContainerPaddingClass,
  presentationCssVars,
  type ProductCardStyleId,
} from "./presentation/tokens";
import { PREVIEW_FONT_VARIABLES } from "./presentation/fonts";
import {
  bannerContentOf,
  benefitsContentOf,
  customContentOf,
  featuredContentOf,
  deliveryPromiseContentOf,
  discoveryContentOf,
  offersContentOf,
  productShelfContentOf,
} from "./presentation/section-content";
import {
  buildWhatsAppUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  sanitizeExternalUrl,
} from "./presentation/urls";
import { cn } from "@/lib/utils";
import { SbcSeal } from "./SbcSeal";
import {
  customizerMessage,
  type CustomizerLocale,
  type CustomizerMessageKey,
} from "./messages";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import { fontFamilyStack } from "./presentation/font-catalogue";
import { resolveGlobalTokens } from "./presentation/global-tokens";
import { resolveSectionDesign } from "./presentation/section-design-resolve";
import { SectionDesignFrame } from "./SectionDesignFrame";
import type { DesignContext } from "./presentation/section-design-resolve";
import {
  PREVIEW_CATEGORIES,
  PREVIEW_STORE_NAME,
} from "./preview-fixtures";
import "./store-preview.css";

const SECTION_TITLE: Record<string, CustomizerMessageKey> = {
  hero: "sectionHero",
  categories: "sectionCategories",
  newArrivals: "sectionNewArrivals",
  wholesale: "sectionWholesale",
  banner: "sectionBanner",
  featured: "sectionFeatured",
  offers: "sectionOffers",
  benefits: "sectionBenefits",
  appPromo: "sectionAppPromo",
  customContent: "sectionCustomContent",
  productShelf: "sectionProductShelf",
  discovery: "sectionDiscovery",
  deliveryPromise: "sectionDeliveryPromise",
};

interface StorefrontPreviewCanvasProps {
  config: StorefrontPresentationConfig;
  locale: CustomizerLocale;
  viewport: "desktop" | "tablet" | "mobile";
  /**
   * CUST-H2-2 — which storefront page is previewed. Defaults to "home" so
   * every existing caller (dev harness, tests) that never passes it keeps
   * rendering exactly the Home preview it always has. "product"/"category"
   * replace only the page-content area below with an honest placeholder;
   * header/footer chrome stays identical across every page (global, per
   * `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`).
   */
  page?: PageType;
  liveStoreName?: string | null;
  businessIdentity?: StorefrontBusinessIdentity;
  /**
   * Click-to-Edit foundation (STORE-CUSTOMIZER-V2-1), upgraded to instance
   * identity in V2-2 (CONTRACT-2): `selectedSection` is a section instance
   * id, and `data-preview-section-id` disambiguates duplicate instances of
   * the same type. `data-preview-section` keeps the *type* for compatibility.
   * Optional so the dev harness mirror stays inert.
   */
  selectedSection?: string | null;
  onSelectSection?: (id: string) => void;
  /**
   * Click-to-edit for fixed chrome (UX V2 §3.2). Not presentation data.
   * Header, logo, footer, WhatsApp and social links route to existing panels.
   */
  selectedChrome?: PreviewChromeTarget | null;
  onSelectChrome?: (target: PreviewChromeTarget) => void;
  /**
   * CUST-H2-3 — the currently previewed Product (editor context only, never
   * presentation authority — see `ExperienceBuilder`'s `previewProductId`)
   * and its structured region document. All optional so every existing
   * caller (dev harness, Home-only tests) that never passes them keeps
   * rendering exactly as before — `page="product"` with these all absent
   * falls back to `productPreviewState="idle"`'s honest empty state.
   */
  productPreviewState?: "idle" | "loading" | "error" | "empty" | "ready";
  previewProduct?: WorkspaceProductDetail | null;
  productRegions?: PageRegionInstance<ProductPageRegionKey>[];
  selectedProductRegionId?: string | null;
  onSelectProductRegion?: (id: string) => void;
  /**
   * CUST-H2-4 — the currently previewed Category (editor context only, never
   * presentation authority — see `ExperienceBuilder`'s `previewCategoryId`)
   * and its structured region document. Same optionality contract as the
   * Product props above.
   */
  categoryPreviewState?: "idle" | "loading" | "error" | "empty" | "ready";
  previewCategory?: WorkspaceCategoryDetail | null;
  categoryRegions?: PageRegionInstance<CategoryPageRegionKey>[];
  selectedCategoryRegionId?: string | null;
  onSelectCategoryRegion?: (id: string) => void;
  /**
   * CUST-H2-4 — the `product_grid` region's real, bounded product preview
   * for the currently previewed Category (see `CategoryPagePreview`'s own
   * doc comment). Sourced from the same Workspace Product API H2-3 built,
   * filtered by `category_id` — never invented client-side.
   */
  categoryGridProductsState?: "idle" | "loading" | "error" | "ready";
  categoryGridProducts?: { id: string; name: string; thumbnailUrl: string | null }[];
  categoryGridProductsTotal?: number;
  /**
   * CUST-H4-3 — the Home "categories" section's own real Canvas preview:
   * the storefront's real root (top-level) categories, replacing the static
   * `PREVIEW_CATEGORIES` fixture this branch used before. Sourced from the
   * same tenant/storefront-scoped workspace categories read `product_grid`
   * above already uses — never invented client-side. `"idle"` is rendered
   * identically to an empty `"ready"` list (no data fetched yet looks the
   * same as "nothing eligible"), exactly like `categoryGridProductsState`'s
   * own convention above.
   */
  homeCategoriesState?: "idle" | "loading" | "error" | "ready";
  homeCategories?: { id: string; name: string }[];
  onRetryHomeCategories?: () => void;
  /**
   * CUST-H4-3 — the Home "newArrivals" section's own real Canvas preview:
   * the storefront's real most-recently-created eligible products, ordered
   * the same way Published's own `NewArrivals.tsx` orders them
   * (`-available_on` → `created_at` desc), replacing the static
   * `PREVIEW_PRODUCTS` fixture this branch used before.
   */
  homeNewArrivalsState?: "idle" | "loading" | "error" | "ready";
  homeNewArrivals?: { id: string; name: string; thumbnailUrl: string | null }[];
  onRetryHomeNewArrivals?: () => void;
  /**
   * CUST-H4-5 — the Home "featured" section's own real Canvas preview.
   * Keyed by section instance id (not a single slot, unlike the two props
   * above) because "featured" is not a singleton section type — a page can
   * hold several Featured rails, each curating its own products. Resolved
   * via one batched `ids[]` read per section instance, the exact same data
   * the picker's own "selected products" chips show — replacing the bare
   * id-text-chip list this branch rendered before.
   */
  featuredResolved?: Record<string, { id: string; name: string; thumbnailUrl: string | null }[]>;
  featuredResolvedState?: Record<string, "idle" | "loading" | "error" | "ready">;
  onRetryFeatured?: (sectionId: string) => void;
  /**
   * CUST-H4-7 — the one shared workspace Offers read (every candidate with
   * its server-computed live/hidden evaluation). Each "offers" section
   * instance maps its own stored `offerIds` over this list; hidden or
   * missing ids render no card (never a fabricated one), and no price,
   * discount or status is computed here.
   */
  offers?: WorkspaceOffer[];
  offersState?: "idle" | "loading" | "error" | "ready";
  onRetryOffers?: () => void;
}

export interface StorefrontBusinessIdentity {
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
}

export type PreviewChromeTarget =
  | "header"
  | "branding"
  | "footer"
  | "whatsapp"
  | "social"
  | "announcements";

export function StorefrontPreviewCanvas({
  config,
  locale,
  viewport,
  page = "home",
  liveStoreName = null,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  selectedSection = null,
  onSelectSection,
  selectedChrome = null,
  onSelectChrome,
  productPreviewState = "idle",
  previewProduct = null,
  productRegions,
  selectedProductRegionId = null,
  onSelectProductRegion,
  categoryPreviewState = "idle",
  previewCategory = null,
  categoryRegions,
  selectedCategoryRegionId = null,
  onSelectCategoryRegion,
  categoryGridProductsState = "idle",
  categoryGridProducts = [],
  categoryGridProductsTotal = 0,
  homeCategoriesState = "idle",
  homeCategories = [],
  onRetryHomeCategories,
  homeNewArrivalsState = "idle",
  homeNewArrivals = [],
  onRetryHomeNewArrivals,
  featuredResolved = {},
  featuredResolvedState = {},
  onRetryFeatured,
  offers = [],
  offersState = "idle",
  onRetryOffers,
}: StorefrontPreviewCanvasProps) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const storeName = previewStoreName(
    config,
    liveStoreName,
    PREVIEW_STORE_NAME[locale],
  );
  // CUST-HV V5e-2a — document-level global tokens: the same pure resolver the published
  // theme wrapper uses (absent ⇒ nothing is added).
  const globalTokens = resolveGlobalTokens(config, config);
  const vars = {
    ...presentationCssVars(config.primaryColor, config.radius, config.accentColor),
    ...(globalTokens?.style ?? {}),
  } as CSSProperties;
  // The published Header only ties `header.style === "compact"` to two things:
  // which logo variant renders, and whether the utility strip shows at all
  // (`(storefront)/layout.tsx`, `Header.tsx`). Every other difference below —
  // the mobile identity grid, search placement, category nav, bottom nav,
  // product-grid columns — is the published shell's own `md`/`lg` responsive
  // behavior, which this fixed-width preview box can only approximate by
  // simulating the selected viewport, never by a merchant's header-style
  // choice. Conflating the two made every Market desktop preview render as
  // if it were mobile, since Market's starting bundle sets header.style to
  // compact by default.
  const mobileViewport = viewport === "mobile";
  const headerStyleCompact = config.header.style === "compact";
  const compact = mobileViewport || headerStyleCompact;
  // CUST-HV V4b — a media reference wins over the legacy embedded image (same
  // precedence as the published storefront). The preview URL is a signed,
  // editor-only workspace URL resolved read-only; absent a reference nothing
  // is fetched and the legacy value renders exactly as before.
  const logoMediaRef =
    (headerStyleCompact && config.branding.compactLogoMedia
      ? config.branding.compactLogoMedia
      : config.branding.logoMedia) ?? null;
  const logoMediaUrl = useMediaRefPreview(logoMediaRef);
  const designContext: DesignContext = {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    palette: config.palette,
    dir: locale === "ar" ? "rtl" : "ltr",
  };
  const logo =
    logoMediaUrl ??
    (headerStyleCompact && config.branding.compactLogoDataUrl
      ? config.branding.compactLogoDataUrl
      : config.branding.logoDataUrl);
  const whatsappHref =
    config.whatsapp.enabled &&
    (config.whatsapp.placement === "floating" ||
      config.whatsapp.placement === "both")
      ? buildWhatsAppUrl(config.whatsapp.phone, config.whatsapp.message)
      : null;
  const footerWhatsapp =
    config.whatsapp.enabled &&
    (config.whatsapp.placement === "footer" ||
      config.whatsapp.placement === "both")
      ? buildWhatsAppUrl(config.whatsapp.phone, config.whatsapp.message)
      : null;
  const density = config.density === "compact" ? "compact" : "comfortable";
  const cardPad = config.productCard === "compact" ? "p-2.5" : "p-3";
  const isMarket = config.themePreset === "awj-market";
  // The exact fixed heights ProductCard.tsx itself resolves to at each
  // breakpoint — not the `sm:`/`md:` classes themselves. This preview frame
  // is a plain, width-constrained div rendered inside the real Customizer
  // page (`data-preview-frame` in ExperienceBuilder.tsx), not an iframe, so
  // Tailwind's responsive prefixes would evaluate against the host browser's
  // actual viewport rather than the simulated device width — a desktop host
  // previewing "mobile" would still get `md:h-40`. Resolving the height
  // explicitly from the `viewport` prop is the only way this preview can
  // match the simulated device rather than the host's real window. None of
  // this preview's three device widths (390/768/1280) ever land in the
  // published `sm` tier (640–767px), so only base/`md` are reachable here.
  const cardImageHeight =
    viewport === "mobile"
      ? isMarket
        ? "h-28"
        : "h-36"
      : isMarket
        ? "h-40"
        : "h-52";
  // Same host-browser-vs-simulated-device problem as `cardImageHeight` above,
  // for the New Arrivals grid's column count. This preview section represents
  // the homepage shelf, which the published storefront renders via
  // `NewArrivals.tsx` — not the (differently-breakpointed) `ProductGrid.tsx`
  // used for catalog/category listing pages. `NewArrivals.tsx` uses
  // `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` for every theme but Market,
  // which widens the desktop tier to 5 (`sm` at 640px, `lg` at 1024px):
  // mobile(390) sits below `sm` for 2 columns, tablet(768) sits at or above
  // `sm` but below `lg` for 3, and desktop(1280) sits at or above `lg` for 4
  // (Modern) or 5 (Market) — all three of this preview's simulated widths
  // land in a different tier here.
  const newArrivalsColumns =
    viewport === "mobile"
      ? "grid-cols-2"
      : viewport === "tablet"
        ? "grid-cols-3"
        : isMarket
          ? "grid-cols-5"
          : "grid-cols-4";
  // Same resolve-from-`viewport` requirement as `newArrivalsColumns` above —
  // real `sm:`/`lg:`/`xl:` prefixes would evaluate against this host browser,
  // not the simulated device. Mirrors `CategoriesSection.tsx`'s real
  // breakpoints (`sm` 640px, `lg` 1024px, `xl` 1280px) for both the Market
  // and default column counts, so the preview and the published homepage
  // agree at every simulated width instead of only by coincidence.
  const categoriesColumns = isMarket
    ? viewport === "mobile"
      ? "grid-cols-3"
      : viewport === "tablet"
        ? "grid-cols-4"
        : "grid-cols-8"
    : viewport === "mobile"
      ? "grid-cols-2"
      : viewport === "tablet"
        ? "grid-cols-3"
        : "grid-cols-6";
  const categoriesGap = isMarket ? "gap-2" : "gap-3";
  const enabledSocial = config.social.flatMap((item) => {
    if (!item.enabled || !isOfficialSocialNetwork(item.network)) return [];
    const href = sanitizeExternalUrl(item.url);
    return href ? [{ ...item, href }] : [];
  });
  const extraNav = config.header.links.filter((link) => {
    if (!link.enabled || !link.label.trim()) return false;
    if (link.kind === "external") {
      return Boolean(sanitizeExternalUrl(link.href));
    }
    return true;
  });
  const ios = isSafeAppStoreUrl(config.apps.iosUrl)
    ? sanitizeExternalUrl(config.apps.iosUrl)
    : null;
  const android = isSafePlayStoreUrl(config.apps.androidUrl)
    ? sanitizeExternalUrl(config.apps.androidUrl)
    : null;
  const hasApps = Boolean(ios || android);
  const visiblePages = config.pages.filter((p) => p.enabled);
  const legalName = businessIdentity.legal_name?.trim() || null;
  const crNumber = businessIdentity.cr_number?.trim() || null;
  const vatNumber = businessIdentity.vat_number?.trim() || null;
  const phone = contactDetailText(config.contact.phone);
  const email = contactDetailText(config.contact.email);
  const address = contactDetailText(config.contact.address);
  const hours = contactDetailText(config.contact.hours);
  const hasBusinessIdentity = Boolean(legalName || crNumber || vatNumber);

  return (
    <div
      data-preview-canvas=""
      data-preview-viewport={viewport}
      data-preview-page={page}
      {...(globalTokens?.attrs ?? {})}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={cn(
        "awj-store-preview relative min-h-full bg-store-background text-store-foreground",
        PREVIEW_FONT_VARIABLES,
      )}
      style={{
        ...vars,
        fontFamily: fontFamilyStack(config.typography?.bodyFamily) ?? fontPresetFamilyStack(config.fontPreset),
      }}
    >
      <p className="sr-only">{t("fixtureCatalogHint")}</p>

      <AnnouncementPreview
        doc={config.announcements}
        page={page}
        locale={locale}
        selected={selectedChrome === "announcements"}
        onSelect={
          onSelectChrome ? () => onSelectChrome("announcements") : undefined
        }
      />

      <header
        style={
          config.announcements?.behaviour?.sticky &&
          announcementBarVisible(config.announcements)
            ? { top: ANNOUNCEMENT_PREVIEW_HEIGHT }
            : undefined
        }
        className={cn(
          "sticky top-0 z-20 bg-store-surface",
          onSelectChrome && "awj-preview-section",
          selectedChrome === "header" && "awj-preview-section-selected",
        )}
        data-preview-chrome={onSelectChrome ? "header" : undefined}
        data-chrome-selected={
          onSelectChrome && selectedChrome === "header" ? "" : undefined
        }
        onClick={
          onSelectChrome
            ? (event) => {
                const inner = (event.target as HTMLElement).closest(
                  "[data-preview-chrome]",
                );
                if (inner && inner !== event.currentTarget) return;
                onSelectChrome("header");
              }
            : undefined
        }
      >
        {onSelectChrome ? (
          <button
            type="button"
            className="sr-only"
            aria-pressed={selectedChrome === "header"}
            onClick={(event) => {
              event.stopPropagation();
              onSelectChrome("header");
            }}
          >
            {t("header")}
          </button>
        ) : null}
        {!compact && (
          <div className="hidden border-b border-store-border bg-store-surface-muted md:block">
            <div className={cn(storeContainerClassName, "flex h-7 items-center justify-end")}>
              <span className="text-[11px] text-store-muted-foreground">
                {locale === "ar" ? "السعودية · ر.س" : "Saudi Arabia · SAR"}
              </span>
            </div>
          </div>
        )}

        <div className="border-b border-store-border">
          <div
            className={cn(
              storeContainerClassName,
              mobileViewport
                ? "grid grid-cols-[1fr_minmax(0,1fr)_1fr] items-center gap-2 py-2"
                : "flex items-center gap-6 py-3",
            )}
          >
            {mobileViewport && (
              <span className="text-xs font-medium text-store-muted-foreground">
                {t("home")}
              </span>
            )}
            <button
              type="button"
              data-preview-chrome={onSelectChrome ? "branding" : undefined}
              aria-pressed={
                onSelectChrome ? selectedChrome === "branding" : undefined
              }
              aria-label={onSelectChrome ? t("branding") : undefined}
              onClick={
                onSelectChrome
                  ? (event) => {
                      event.stopPropagation();
                      onSelectChrome("branding");
                    }
                  : undefined
              }
              className={cn(
                "inline-flex min-w-0 max-w-full",
                onSelectChrome && "awj-preview-section",
                selectedChrome === "branding" && "awj-preview-section-selected",
                mobileViewport && "justify-self-center",
              )}
            >
              <StoreBrand
                href="#preview"
                name={storeName}
                size="md"
                logoUrl={logo}
                linked={!onSelectChrome}
              />
            </button>
            {config.header.showSearch && !mobileViewport && (
              <div className="flex min-h-10 flex-1 items-center gap-2 rounded-store border border-store-border bg-store-surface px-3 text-sm text-store-muted-foreground">
                <Search className="size-4" aria-hidden />
                {t("search")}
              </div>
            )}
            <div className={cn("flex items-center gap-1", mobileViewport && "justify-self-end")}>
              {config.header.showAccount && !mobileViewport && (
                <span className="inline-flex size-9 items-center justify-center text-store-foreground">
                  <User className="size-5" aria-hidden />
                  <span className="sr-only">{t("account")}</span>
                </span>
              )}
              {config.header.showCart && (
                <span className="inline-flex h-9 items-center gap-1.5 rounded-store px-2 text-sm font-medium text-store-foreground">
                  <ShoppingBag className="size-5" aria-hidden />
                  {!mobileViewport && t("cart")}
                </span>
              )}
            </div>
            {config.header.showSearch && mobileViewport && (
              <div className="col-span-3 flex min-h-9 items-center gap-2 rounded-store border border-store-border px-3 text-xs text-store-muted-foreground">
                <Search className="size-3.5" aria-hidden />
                {t("search")}
              </div>
            )}
          </div>
        </div>

        {(config.header.showCategoryNav || extraNav.length > 0) && !mobileViewport && (
          <nav
            aria-label={t("sectionCategories")}
            className="border-b border-store-border bg-store-surface-muted"
          >
            <div className={cn(storeContainerClassName, "flex h-9 items-center gap-4 overflow-hidden text-sm")}>
              {config.header.showCategoryNav ? (
                <>
                  <span className="rounded-md bg-store-surface px-2 py-1 font-medium text-store-foreground">
                    {t("allProducts")}
                  </span>
                  {PREVIEW_CATEGORIES.map((category) => (
                    <span key={category.id} className="text-store-muted-foreground">
                      {category.name[locale]}
                    </span>
                  ))}
                </>
              ) : null}
              {extraNav.map((link) => (
                <span
                  key={link.id}
                  data-extra-nav=""
                  className="text-store-muted-foreground"
                >
                  {link.label}
                </span>
              ))}
            </div>
          </nav>
        )}
      </header>

      {page === "product" ? (
        <ProductPagePreview
          locale={locale}
          density={density}
          state={productPreviewState}
          product={previewProduct}
          regions={productRegions ?? []}
          selectedRegionId={selectedProductRegionId}
          onSelectRegion={onSelectProductRegion}
        />
      ) : page === "category" ? (
        <CategoryPagePreview
          locale={locale}
          density={density}
          productCard={config.productCard}
          state={categoryPreviewState}
          category={previewCategory}
          regions={categoryRegions ?? []}
          selectedRegionId={selectedCategoryRegionId}
          onSelectRegion={onSelectCategoryRegion}
          gridProductsState={categoryGridProductsState}
          gridProducts={categoryGridProducts}
          gridProductsTotal={categoryGridProductsTotal}
        />
      ) : (
      <div
        className={cn(
          storeContainerClassName,
          density === "compact" ? "space-y-6 py-3" : "space-y-8 py-4 md:space-y-10 md:py-6",
        )}
      >
        {config.homepage.sections
          .filter((section) => section.visible)
          .map((section) => {
            const content = ((): ReactNode => {
            if (section.type === "hero") {
              const title = config.homepage.heroHeadline.trim() || storeName;
              const sub = config.homepage.heroSubheadline.trim();
              return (
                <section
                  key="hero"
                  aria-label={t("sectionHero")}
                  className="flex min-h-[11rem] items-center rounded-store bg-gradient-to-r from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground md:min-h-[16rem]"
                >
                  <div data-section-content="" className="max-w-2xl p-5 md:p-10">
                    <h1 className="text-xl font-black leading-tight sm:text-2xl lg:text-4xl">
                      <bdi>{title}</bdi>
                    </h1>
                    {sub ? (
                      <p className="mt-2 line-clamp-2 text-xs text-store-primary-foreground/80 md:mt-3 md:text-sm">
                        {sub}
                      </p>
                    ) : null}
                    <span className="mt-4 inline-flex h-9 items-center rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary md:mt-5 md:h-11 md:px-6 md:text-sm">
                      {t("shopNow")}
                    </span>
                  </div>
                </section>
              );
            }

            if (section.type === "categories") {
              return (
                <section key="categories" aria-labelledby="preview-categories">
                  <SectionRule title={t("browseCategories")} action={t("viewAll")} />
                  {/* "idle" (no fetch triggered yet — e.g. no storefrontId,
                      or a direct render with no `ExperienceBuilder` data
                      wired up) renders identically to "loading": unknown
                      is not the same claim as "confirmed empty," so it must
                      not jump straight to the empty-state copy. */}
                  {homeCategoriesState === "loading" || homeCategoriesState === "idle" ? (
                    <ul
                      aria-hidden="true"
                      className={cn("mt-4 grid", categoriesGap, categoriesColumns)}
                    >
                      {Array.from({ length: 6 }).map((_, index) => (
                        <li
                          key={index}
                          className={cn(
                            "animate-pulse rounded-store bg-store-surface-muted",
                            isMarket ? "h-14" : "h-16",
                          )}
                        />
                      ))}
                    </ul>
                  ) : homeCategoriesState === "error" ? (
                    <div
                      data-home-categories-error=""
                      className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"
                    >
                      <p className="text-sm text-store-muted-foreground">{t("homeCategoriesLoadFailed")}</p>
                      {onRetryHomeCategories && (
                        <button
                          type="button"
                          onClick={onRetryHomeCategories}
                          className="rounded-store border border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground hover:bg-store-surface-muted"
                        >
                          {t("retry")}
                        </button>
                      )}
                    </div>
                  ) : homeCategories.length === 0 ? (
                    <p
                      data-home-categories-empty=""
                      className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground"
                    >
                      {t("homeCategoriesEmpty")}
                    </p>
                  ) : (
                    <ul className={cn("mt-4 grid", categoriesGap, categoriesColumns)}>
                      {homeCategories.map((category) => (
                        <li key={category.id}>
                          <div
                            className={cn(
                              "flex h-full flex-col justify-center gap-0.5 rounded-store border border-store-border border-s-[3px] bg-store-surface",
                              isMarket ? "px-3 py-2.5" : "px-4 py-3.5",
                            )}
                            style={{ borderInlineStartColor: "var(--store-border-strong)" }}
                          >
                            <span
                              className={cn(
                                "line-clamp-2 font-bold leading-snug text-store-foreground",
                                isMarket ? "text-xs" : "text-sm",
                              )}
                            >
                              <bdi>{category.name}</bdi>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "newArrivals") {
              return (
                <section key="newArrivals" aria-labelledby="preview-arrivals">
                  <SectionRule title={t("newArrivals")} action={t("viewAll")} />
                  {/* Same "idle" ≡ "loading" rule as the categories section
                      above — see its comment. */}
                  {homeNewArrivalsState === "loading" || homeNewArrivalsState === "idle" ? (
                    <ul
                      aria-hidden="true"
                      className={cn("mt-4 grid gap-3", newArrivalsColumns)}
                    >
                      {Array.from({ length: 4 }).map((_, index) => (
                        <li
                          key={index}
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div className={cn(cardImageHeight, "animate-pulse bg-store-surface-muted")} />
                          <div className={cardPad}>
                            <div className="h-3 w-3/4 animate-pulse rounded-store bg-store-surface-muted" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : homeNewArrivalsState === "error" ? (
                    <div
                      data-home-new-arrivals-error=""
                      className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"
                    >
                      <p className="text-sm text-store-muted-foreground">{t("homeNewArrivalsLoadFailed")}</p>
                      {onRetryHomeNewArrivals && (
                        <button
                          type="button"
                          onClick={onRetryHomeNewArrivals}
                          className="rounded-store border border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground hover:bg-store-surface-muted"
                        >
                          {t("retry")}
                        </button>
                      )}
                    </div>
                  ) : homeNewArrivals.length === 0 ? (
                    <p
                      data-home-new-arrivals-empty=""
                      className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground"
                    >
                      {t("homeNewArrivalsEmpty")}
                    </p>
                  ) : (
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)}>
                      {homeNewArrivals.map((product) => (
                        <li
                          key={product.id}
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div
                            className={cn(
                              cardImageHeight,
                              "relative bg-store-surface-muted",
                            )}
                          >
                            {product.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset
                              <img
                                src={product.thumbnailUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : null}
                            {/* Decorative only — the real quick-view dialog
                                (`QuickView.tsx`) needs a live cart/store
                                context this static preview frame doesn't
                                have. This mirrors its trigger's exact
                                position/icon so a merchant sees the
                                affordance before publishing. */}
                            {isMarket && (
                              <span className="absolute bottom-2 start-2 inline-flex size-8 items-center justify-center rounded-full bg-store-surface/90 text-store-foreground shadow-sm">
                                <Eye className="size-4" aria-hidden="true" />
                              </span>
                            )}
                          </div>
                          <div className={cardPad}>
                            <p className="line-clamp-2 text-sm font-semibold text-store-foreground">
                              <bdi>{product.name}</bdi>
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "wholesale") {
              return (
                <section
                  key="wholesale"
                  className="rounded-store bg-store-footer px-5 py-6 text-store-footer-foreground md:px-8"
                >
                  <h2 className="text-base font-extrabold md:text-lg">{t("wholesale")}</h2>
                  <p className="mt-1 max-w-xl text-sm text-store-footer-muted">
                    {locale === "ar"
                      ? "بوابة الجملة تبقى كما صُممت في المتجر، ومشروطة بإعداد القناة."
                      : "The wholesale block stays as designed on the storefront, gated by channel configuration."}
                  </p>
                </section>
              );
            }

            if (section.type === "banner") {
              const banner = bannerContentOf(section);
              const empty =
                !banner.title &&
                !banner.subtitle &&
                !banner.ctaLabel &&
                !banner.imageUrl;
              const ctaHrefOk =
                banner.ctaHref.startsWith("https://") || banner.ctaHref.startsWith("/");
              return (
                <section key={section.id} className="overflow-hidden rounded-store border border-store-border bg-store-surface">
                  {empty ? (
                    <p data-section-content="" className="px-5 py-6 text-sm text-store-muted-foreground">{t("sectionBanner")}</p>
                  ) : (
                    <div data-section-content="" className="flex min-w-0 flex-col gap-4 p-5 md:flex-row md:items-center md:p-8">
                      {banner.imageUrl ? (
                        <img
                          src={banner.imageUrl}
                          alt={banner.imageAlt?.trim() || ""}
                          className="h-36 w-full rounded-store object-cover md:h-40 md:w-56 md:shrink-0"
                        />
                      ) : null}
                      <div className="min-w-0">
                        {banner.title ? (
                          <h2 className="break-words text-lg font-extrabold text-store-foreground md:text-2xl">{banner.title}</h2>
                        ) : null}
                        {banner.subtitle ? (
                          <p className="mt-2 max-w-2xl break-words text-sm text-store-muted-foreground">{banner.subtitle}</p>
                        ) : null}
                        {banner.ctaLabel && ctaHrefOk ? (
                          <span className="mt-4 inline-flex h-10 items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground">
                            {banner.ctaLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </section>
              );
            }

            if (section.type === "benefits") {
              const items = benefitsContentOf(section).items.filter((item) => item.title || item.body);
              // A section without a design keeps its legacy preview exactly; the published
              // card surface (and the block marker its design rules address) apply only
              // while a design frame wraps it.
              const designed = resolveSectionDesign(section.type, section.design, designContext) !== null;
              return (
                <section key={section.id} data-section-block={designed ? "" : undefined}>
                  <h2 className="text-base font-extrabold">{t("sectionBenefits")}</h2>
                  {items.length === 0 ? (
                    <p className="mt-2 text-sm text-store-muted-foreground">{t("sectionBenefits")}</p>
                  ) : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item) => (
                        <li key={item.id} className={cn("min-w-0 break-words rounded-store border border-store-border", designed ? "bg-store-surface px-4 py-4" : "px-3 py-3")}>
                          {item.title ? <p className="break-words text-sm font-bold">{item.title}</p> : null}
                          {item.body ? <p className="break-words text-sm text-store-muted-foreground">{item.body}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "customContent") {
              const blocks = customContentOf(section).blocks.filter((block) => block.text.trim());
              // AWJ Market presents multi-question content as an accordion (published
              // `CustomContentBand`): mirror its cards so the preview shows the same surfaces.
              const groups: Array<{ heading: (typeof blocks)[number] | null; body: typeof blocks }> = [];
              for (const block of blocks) {
                if (block.kind === "heading") groups.push({ heading: block, body: [] });
                else if (groups.length === 0) groups.push({ heading: null, body: [block] });
                else groups[groups.length - 1].body.push(block);
              }
              // The accordion mirror belongs to a designed section (its card surfaces are what the
              // design rules reason about); an undesigned one keeps its flat legacy preview.
              const designedContent = resolveSectionDesign(section.type, section.design, designContext) !== null;
              if (designedContent && config.themePreset === "awj-market" && groups.filter((group) => group.heading).length >= 2) {
                return (
                  <section key={section.id} className="min-w-0 max-w-3xl space-y-2 break-words">
                    {groups.map((group, index) =>
                      group.heading ? (
                        <details key={group.heading.id} className="group rounded-store border border-store-border bg-store-surface px-4 open:pb-4">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-bold text-store-foreground marker:content-none">
                            <span className="break-words">{group.heading.text}</span>
                          </summary>
                          <div className="space-y-2">
                            {group.body.map((block) => (
                              <p key={block.id} className="break-words text-sm leading-relaxed text-store-muted-foreground">{block.text}</p>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <div key={`preamble-${index}`} className="space-y-2">
                          {group.body.map((block) => (
                            <p key={block.id} className="break-words text-sm text-store-muted-foreground">{block.text}</p>
                          ))}
                        </div>
                      ),
                    )}
                  </section>
                );
              }
              return (
                <section key={section.id} className="min-w-0 max-w-3xl space-y-2 break-words">
                  {blocks.length === 0 ? (
                    <p className="text-sm text-store-muted-foreground">{t("sectionCustomContent")}</p>
                  ) : (
                    blocks.map((block) =>
                      block.kind === "heading" ? (
                        <h2 key={block.id} className="break-words text-lg font-extrabold">{block.text}</h2>
                      ) : (
                        <p key={block.id} className="break-words text-sm text-store-muted-foreground">{block.text}</p>
                      ),
                    )
                  )}
                </section>
              );
            }

            if (section.type === "featured") {
              // CUST-H4-5 — real Commerce product data, resolved in one
              // batched `ids[]` request per section instance (see
              // `ExperienceBuilder`'s `featuredResolved` map) — never the
              // bare id-text-chip list this branch rendered before.
              const ids = featuredContentOf(section).productIds.filter((id) => id);
              const resolvedState = ids.length === 0 ? "ready" : (featuredResolvedState[section.id] ?? "idle");
              const products = featuredResolved[section.id] ?? [];
              const headingId = `preview-featured-${section.id}`;
              return (
                <section key={section.id} aria-labelledby={headingId}>
                  <h2 id={headingId} className="text-base font-extrabold">{t("sectionFeatured")}</h2>
                  {resolvedState === "loading" || resolvedState === "idle" ? (
                    <ul
                      aria-hidden="true"
                      className={cn("mt-4 grid gap-3", newArrivalsColumns)}
                    >
                      {Array.from({ length: Math.min(ids.length, 4) || 4 }).map((_, index) => (
                        <li
                          key={index}
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div className={cn(cardImageHeight, "animate-pulse bg-store-surface-muted")} />
                          <div className={cardPad}>
                            <div className="h-3 w-3/4 animate-pulse rounded-store bg-store-surface-muted" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : resolvedState === "error" ? (
                    <div
                      data-home-featured-error=""
                      className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"
                    >
                      <p className="text-sm text-store-muted-foreground">{t("homeFeaturedLoadFailed")}</p>
                      <button
                        type="button"
                        onClick={() => onRetryFeatured?.(section.id)}
                        className="rounded-store border border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground hover:bg-store-surface-muted"
                      >
                        {t("retry")}
                      </button>
                    </div>
                  ) : products.length === 0 ? (
                    <p
                      data-home-featured-empty=""
                      className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground"
                    >
                      {t("homeFeaturedEmpty")}
                    </p>
                  ) : (
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)}>
                      {ids
                        .map((id) => products.find((product) => product.id === id))
                        .filter((product): product is NonNullable<typeof product> => product !== undefined)
                        .map((product) => (
                          <li
                            key={product.id}
                            className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                          >
                            <div className={cn(cardImageHeight, "bg-store-surface-muted")}>
                              {product.thumbnailUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset
                                <img
                                  src={product.thumbnailUrl}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className={cardPad}>
                              <p className="line-clamp-2 text-sm font-semibold text-store-foreground">
                                <bdi>{product.name}</bdi>
                              </p>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "offers") {
              // CUST-H4-7 — real Commerce data. The workspace Offers read is
              // shared by every Offers instance (one request); this instance
              // keeps only the rows its own `offerIds` selects, in the
              // merchant's stored order. A hidden/missing selected offer is
              // omitted (the editor explains why) — Canvas never invents a
              // card, a price or a discount, and never recomputes any of them.
              const ids = offersContentOf(section).offerIds.filter((id) => id);
              const resolvedState = ids.length === 0 ? "ready" : offersState;
              const byId = new Map(offers.map((offer) => [offer.id, offer]));
              const liveOffers = ids
                .map((id) => byId.get(id))
                .filter(
                  (offer): offer is WorkspaceOffer & { product: NonNullable<WorkspaceOffer["product"]> } =>
                    offer !== undefined && offer.isLive && offer.product !== null,
                );
              const headingId = `preview-offers-${section.id}`;
              return (
                <section key={section.id} aria-labelledby={headingId}>
                  <h2 id={headingId} className="text-base font-extrabold">{t("sectionOffers")}</h2>
                  {resolvedState === "loading" || resolvedState === "idle" ? (
                    <ul
                      aria-hidden="true"
                      className={cn("mt-4 grid gap-3", newArrivalsColumns)}
                    >
                      {Array.from({ length: Math.min(ids.length, 4) || 4 }).map((_, index) => (
                        <li
                          key={index}
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div className={cn(cardImageHeight, "animate-pulse bg-store-surface-muted")} />
                          <div className={cardPad}>
                            <div className="h-3 w-3/4 animate-pulse rounded-store bg-store-surface-muted" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : resolvedState === "error" ? (
                    <div
                      data-home-offers-error=""
                      className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"
                    >
                      <p className="text-sm text-store-muted-foreground">{t("homeOffersLoadFailed")}</p>
                      <button
                        type="button"
                        onClick={() => onRetryOffers?.()}
                        className="rounded-store border border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground hover:bg-store-surface-muted"
                      >
                        {t("retry")}
                      </button>
                    </div>
                  ) : ids.length === 0 ? (
                    <p
                      data-home-offers-empty=""
                      className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground"
                    >
                      {t("homeOffersEmpty")}
                    </p>
                  ) : liveOffers.length === 0 ? (
                    <p
                      data-home-offers-none-live=""
                      className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground"
                    >
                      {t("homeOffersNoneLive")}
                    </p>
                  ) : (
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)}>
                      {liveOffers.map((offer) => (
                        <li
                          key={offer.id}
                          data-home-offer-card=""
                          // `relative` contains the card's sr-only price labels: an absolutely
                          // positioned sr-only span otherwise escapes the clipped preview
                          // scroller and widens the document (horizontal page scroll).
                          className="relative min-w-0 overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div className={cn(cardImageHeight, "relative bg-store-surface-muted")}>
                            {offer.product.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset
                              <img
                                src={offer.product.thumbnailUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : null}
                            {isDiscountBadgeVisible(offer.discountPercent) ? (
                              <span
                                data-home-offer-badge=""
                                className="absolute start-2 top-2 rounded-md bg-store-accent px-2 py-0.5 text-[0.625rem] font-bold text-store-accent-foreground"
                              >
                                <bdi>{offerDiscountBadgeText(offer.discountPercent, locale)}</bdi>
                              </span>
                            ) : null}
                          </div>
                          <div className={cardPad}>
                            <p className="line-clamp-2 break-words text-sm font-semibold text-store-foreground">
                              <bdi>{offerDisplayName(offer, locale)}</bdi>
                            </p>
                            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              {offer.offerPrice ? (
                                <span className="text-sm font-black text-store-primary">
                                  <span className="sr-only">{t("offersOfferPrice")}: </span>
                                  <bdi data-home-offer-price="">{formatOfferMoney(offer.offerPrice, locale)}</bdi>
                                </span>
                              ) : null}
                              {offer.referencePrice ? (
                                <span className="text-xs text-store-muted-foreground line-through">
                                  <span className="sr-only">{t("offersReferencePrice")}: </span>
                                  <bdi data-home-offer-reference="">{formatOfferMoney(offer.referencePrice, locale)}</bdi>
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "appPromo") {
              if (!hasApps) {
                return (
                  <section key={section.id} className="rounded-store border border-dashed border-store-border px-4 py-5">
                    <h2 className="text-sm font-bold">{t("sectionAppPromo")}</h2>
                    <p className="mt-1 text-xs text-store-muted-foreground">{t("appPromoNote")}</p>
                  </section>
                );
              }
              return (
                <section key={section.id} className="rounded-store bg-store-footer px-5 py-6 text-store-footer-foreground">
                  <h2 className="text-base font-extrabold">{config.apps.appName.trim() || t("sectionAppPromo")}</h2>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {ios ? (
                      <OfficialStoreBadge
                        store="apple"
                        href={ios}
                        locale={locale}
                        label="App Store"
                        onClick={(event) => event.preventDefault()}
                      />
                    ) : null}
                    {android ? (
                      <OfficialStoreBadge
                        store="google"
                        href={android}
                        locale={locale}
                        label="Google Play"
                        onClick={(event) => event.preventDefault()}
                      />
                    ) : null}
                  </div>
                </section>
              );
            }

            if (
              section.type === "productShelf" ||
              section.type === "discovery" ||
              section.type === "deliveryPromise"
            ) {
              // FLOWERS-H9c / ADR-21 — data-backed sections read live store data
              // on the published storefront. The builder never fabricates
              // products, counts or delivery windows: this is an honest
              // placeholder that shows only what the merchant authored. An
              // incomplete section (no stored content) is flagged because the
              // storefront omits it.
              const incomplete =
                section.type !== "deliveryPromise" && section.content === undefined;
              let title = "";
              let note: CustomizerMessageKey = "canvasShelfLive";
              let badge: string | null = null;
              if (section.type === "productShelf") {
                const shelf = productShelfContentOf(section);
                title = shelf.title.trim();
                note = "canvasShelfLive";
                badge = shelf.deliverToday ? t("canvasShelfDeliverToday") : null;
              } else if (section.type === "discovery") {
                title = discoveryContentOf(section).title.trim();
                note = "canvasDiscoveryLive";
              } else {
                const promise = deliveryPromiseContentOf(section);
                title = promise.title.trim();
                note = "canvasDeliveryPromiseLive";
              }
              const headingId = `preview-data-${section.id}`;
              return (
                <section
                  key={section.id}
                  aria-labelledby={headingId}
                  data-home-data-section={section.type}
                  data-incomplete={incomplete ? "" : undefined}
                  className="rounded-store border border-dashed border-store-border-strong bg-store-surface px-4 py-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 id={headingId} className="text-sm font-bold text-store-foreground">
                      {title || t(SECTION_TITLE[section.type] ?? "sectionCustomContent")}
                    </h2>
                    {badge ? (
                      <span className="text-[11px] font-medium text-store-muted-foreground">{badge}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-store-muted-foreground">
                    {incomplete ? t("canvasDataSectionIncomplete") : t(note)}
                  </p>
                </section>
              );
            }

            return (
              <section
                key={section.id}
                className="rounded-store border border-dashed border-store-border-strong bg-store-surface px-4 py-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-store-foreground">
                    {t(SECTION_TITLE[section.type] ?? "sectionCustomContent")}
                  </h2>
                  {isGatedHomeSection(section.type) && (
                    <span className="text-[11px] font-medium text-store-muted-foreground">
                      {t("gatedBadge")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-store-muted-foreground">{t("gatedSection")}</p>
              </section>
            );
            })();
            if (!content) return null;
            return (
              <SelectablePreviewSection
                key={section.id}
                sectionKey={section.type}
                sectionId={section.id}
                selected={selectedSection === section.id}
                onSelect={onSelectSection}
              >
                <SectionDesignFrame section={section} context={designContext}>
                  {content}
                </SectionDesignFrame>
              </SelectablePreviewSection>
            );
          })}
      </div>
      )}

      <footer
        className={cn(
          "bg-store-footer text-store-footer-link",
          onSelectChrome && "awj-preview-section",
          selectedChrome === "footer" && "awj-preview-section-selected",
        )}
        data-preview-chrome={onSelectChrome ? "footer" : undefined}
        data-chrome-selected={
          onSelectChrome && selectedChrome === "footer" ? "" : undefined
        }
        onClick={
          onSelectChrome
            ? (event) => {
                const inner = (event.target as HTMLElement).closest(
                  "[data-preview-chrome]",
                );
                if (inner && inner !== event.currentTarget) return;
                onSelectChrome("footer");
              }
            : undefined
        }
      >
        {onSelectChrome ? (
          <button
            type="button"
            className="sr-only"
            aria-pressed={selectedChrome === "footer"}
            onClick={(event) => {
              event.stopPropagation();
              onSelectChrome("footer");
            }}
          >
            {t("footer")}
          </button>
        ) : null}
        <div className={cn(storeContainerClassName, "py-10 md:py-12")}>
          {config.footer.showLogo && (
            <button
              type="button"
              data-preview-chrome={onSelectChrome ? "branding" : undefined}
              aria-label={onSelectChrome ? t("branding") : undefined}
              onClick={
                onSelectChrome
                  ? (event) => {
                      event.stopPropagation();
                      onSelectChrome("branding");
                    }
                  : undefined
              }
              className="inline-flex min-w-0 max-w-full"
            >
              <StoreBrand
                href="#preview"
                name={storeName}
                tone="dark"
                size="md"
                logoUrl={logo}
                linked={!onSelectChrome}
              />
            </button>
          )}
          {config.footer.tagline.trim() ? (
            <p className="mt-3 max-w-lg break-words text-sm text-store-footer-muted">
              {config.footer.tagline}
            </p>
          ) : null}
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-store-footer-border pt-8 sm:grid-cols-3">
            <FooterCol title={t("shop")}>
              <span>{t("allProducts")}</span>
              {PREVIEW_CATEGORIES.slice(0, 4).map((category) => (
                <span key={category.id}>{category.name[locale]}</span>
              ))}
            </FooterCol>
            <FooterCol title={t("account")}>
              <span>{t("account")}</span>
              <span>{t("cart")}</span>
            </FooterCol>
            <FooterCol title={t("policies")}>
              {visiblePages.length
                ? visiblePages.map((page) => (
                    <span key={page.id}>
                      {page.title.trim() || t(pageTitleKey(page.slug))}
                    </span>
                  ))
                : <span>{t("pagesHint")}</span>}
            </FooterCol>
          </div>
          {(phone ||
            email ||
            address ||
            hours ||
            footerWhatsapp ||
            enabledSocial.length > 0 ||
            hasBusinessIdentity ||
            config.verification.licenseNumber.trim() ||
            config.sbc.show_in_storefront ||
            (hasApps && config.apps.showFooterLinks)) && (
            <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 border-t border-store-footer-border pt-6 text-sm text-store-footer-muted sm:grid-cols-2 lg:grid-cols-3">
              {hasBusinessIdentity ? (
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-store-footer-foreground">
                    {t("businessInformation")}
                  </h3>
                  <div className="mt-3 break-words">
                    {legalName ? (
                      <p className="break-words">
                        {t("legalName")}: {legalName}
                      </p>
                    ) : null}
                    <IdentityDetail
                      kind="cr"
                      label={t("crNumber")}
                      value={crNumber}
                    />
                    <IdentityDetail
                      kind="vat"
                      label={t("vatNumber")}
                      value={vatNumber}
                    />
                  </div>
                </section>
              ) : null}
              {config.verification.licenseNumber.trim() ? (
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-store-footer-foreground">
                    {t("merchantProvided")}
                  </h3>
                  <p className="mt-3 break-words">
                    {t("licenseNumber")}: {config.verification.licenseNumber}
                  </p>
                </section>
              ) : null}
              {config.sbc.show_in_storefront ? (
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-store-footer-foreground">
                    {t("sbcGroup")}
                  </h3>
                  <div className="mt-3">
                    {config.sbc.seal_token.trim() ? (
                      <SbcSeal message={t("sbcSealPreview")} />
                    ) : (
                      <p className="font-medium text-store-footer-link">
                        {t("sbcVerified")}
                      </p>
                    )}
                  </div>
                </section>
              ) : null}
              {phone ||
              email ||
              address ||
              hours ||
              footerWhatsapp ||
              enabledSocial.length > 0 ? (
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-store-footer-foreground">
                    {t("communication")}
                  </h3>
                  <div className="mt-3 space-y-2 break-words">
                    {phone ? <ContactDetail kind="phone" value={phone} /> : null}
                    {email ? <ContactDetail kind="email" value={email} /> : null}
                    {address ? (
                      <ContactDetail kind="address" value={address} />
                    ) : null}
                    {hours ? <ContactDetail kind="hours" value={hours} /> : null}
                    {footerWhatsapp ? (
                      <p>
                        <a
                          href={footerWhatsapp}
                          data-preview-chrome="whatsapp"
                          className="inline-flex min-h-11 items-center gap-2 text-store-footer-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onSelectChrome?.("whatsapp");
                          }}
                        >
                          <OfficialSocialMark network="whatsapp" />
                          {t("whatsapp")}
                        </a>
                      </p>
                    ) : null}
                    {enabledSocial.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {enabledSocial.map((item) => {
                          const label = socialLabel(t, item.network);
                          return (
                            <a
                              key={item.id}
                              href={item.href}
                              aria-label={label}
                              data-preview-chrome="social"
                              className={officialSocialLinkClassName}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onSelectChrome?.("social");
                              }}
                            >
                              <OfficialSocialMark network={item.network} />
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {hasApps && config.apps.showFooterLinks ? (
                <section className="min-w-0">
                  <h3 className="text-sm font-bold text-store-footer-foreground">
                    {t("applications")}
                  </h3>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {ios ? (
                      <OfficialStoreBadge
                        store="apple"
                        href={ios}
                        locale={locale}
                        label="App Store"
                        onClick={(event) => event.preventDefault()}
                      />
                    ) : null}
                    {android ? (
                      <OfficialStoreBadge
                        store="google"
                        href={android}
                        locale={locale}
                        label="Google Play"
                        onClick={(event) => event.preventDefault()}
                      />
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
        <div className="border-t border-store-footer-border">
          <div className={cn(storeContainerClassName, "py-5")}>
            <p className="break-words text-xs text-store-footer-muted">
              {config.footer.copyright.trim() || `© ${storeName}`}
            </p>
          </div>
        </div>
      </footer>

      {mobileViewport && (
        <nav
          aria-label={t("home")}
          className="sticky bottom-0 border-t border-store-border bg-store-surface"
        >
          <ul className="grid grid-cols-4 text-[11px] text-store-muted-foreground">
            <li className="flex flex-col items-center gap-0.5 py-2 text-store-primary">
              <Home className="size-4" />
              {t("home")}
            </li>
            <li className="flex flex-col items-center gap-0.5 py-2">
              <LayoutGrid className="size-4" />
              {t("products")}
            </li>
            <li className="flex flex-col items-center gap-0.5 py-2">
              <ShoppingBag className="size-4" />
              {t("cart")}
            </li>
            <li className="flex flex-col items-center gap-0.5 py-2">
              <User className="size-4" />
              {t("account")}
            </li>
          </ul>
        </nav>
      )}

      {whatsappHref && (
        <a
          href={whatsappHref}
          data-preview-chrome="whatsapp"
          aria-label={t("whatsappAria")}
          aria-pressed={selectedChrome === "whatsapp" ? true : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectChrome?.("whatsapp");
          }}
          className={cn(
            "absolute z-30 inline-flex size-12 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111827]",
            onSelectChrome && "awj-preview-section",
            selectedChrome === "whatsapp" && "awj-preview-section-selected",
            mobileViewport ? "end-3 bottom-16" : "end-4 bottom-4",
          )}
        >
          <OfficialSocialMark network="whatsapp" size="floating" />
        </a>
      )}
    </div>
  );
}

function formatMinorAmount(amountMinor: number, currency: string, locale: CustomizerLocale): string {
  try {
    // `displayLocale()` forces Gregorian calendar + Latin digits (`-nu-latn`)
    // regardless of Arabic/English — the same guardrail every date/number
    // display in this codebase already goes through (`lib/formatting.ts`),
    // avoiding Eastern Arabic digits some ICU builds would otherwise emit.
    return new Intl.NumberFormat(displayLocale(locale), {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * CUST-H2-3 — real structured Product-page preview. Reuses the exact
 * presentation meaning of `storefront/.../products/[slug]/ProductDetails.tsx`
 * (region order, which fields exist, which are honestly omitted when a
 * Product lacks the data) via inline JSX and the same `store-*` CSS-variable
 * classes Home's own preview already uses — **not** a cross-package import
 * of that component, which is a separate Next.js app with no established
 * cross-app component boundary anywhere in this codebase (Home's own
 * preview is the same kind of parallel reimplementation, not an import
 * either). Region order/visibility comes from `regions` (the caller's
 * already-resolved effective list — default contract or the draft's own
 * `pagePresentation.product.regions`); `custom_fields`/`sku_options_details`
 * regions honestly omit themselves when the previewed Product has no such
 * data, exactly like the real `ProductCustomFields` component does, never
 * fabricating content.
 *
 * AWJ Decision (found by this slice's own Playwright pass, not a
 * hypothetical): `ProductDetails.tsx`'s real two-column gallery/content grid
 * (`lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]`) assumes an unconstrained
 * ~1024px+ browser viewport. The Customizer's own preview frame is a
 * *scaled-down container* that stays well under that even for the "desktop"
 * simulated device, once the editor's sidebar/inspector panels take their
 * share of a real window. A `lg:` media query activates purely on the real
 * browser viewport, not this container's width, so at a real ≥1024px window
 * it forced the two-column grid inside a much narrower box: `minmax(0,34rem)`
 * sized its first track from the gallery's own preferred near-square size
 * rather than the container's actual budget, squeezing the content column
 * to a sliver and wrapping Arabic titles almost one character per line —
 * while still geometrically escaping the frame's own `overflow-hidden` clip
 * (confirmed: `document.documentElement.scrollWidth` grew regardless of that
 * clip). This Tailwind setup has no `@container` support to size off the
 * frame's own width instead, so the Product preview always stacks
 * single-column (gallery, then content) — the exact same region order and
 * content the real desktop layout shows, matching the task's own "reuse the
 * same presentation meaning, not the exact transport mechanism" instruction;
 * only the desktop-only side-by-side arrangement is not replicated
 * in-editor.
 */
function ProductPagePreview({
  locale,
  density,
  state,
  product,
  regions,
  selectedRegionId,
  onSelectRegion,
}: {
  locale: CustomizerLocale;
  density: "compact" | "comfortable";
  state: "idle" | "loading" | "error" | "empty" | "ready";
  product: WorkspaceProductDetail | null;
  regions: PageRegionInstance<ProductPageRegionKey>[];
  selectedRegionId?: string | null;
  onSelectRegion?: (id: string) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  if (state !== "ready" || product === null) {
    const bodyKey: CustomizerMessageKey =
      state === "loading"
        ? "productPreviewLoading"
        : state === "error"
          ? "productPreviewLoadFailed"
          : state === "empty"
            ? "productPreviewNoEligibleProducts"
            : "productPreviewSelectAProduct";
    return (
      <div
        data-product-preview-state={state}
        className={cn(
          storeContainerClassName,
          density === "compact" ? "py-10" : "py-14 md:py-20",
        )}
      >
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-store-surface-muted text-store-muted-foreground">
            <PageIcon page="product" />
          </span>
          <p className="text-sm leading-6 text-store-muted-foreground">{t(bodyKey)}</p>
        </div>
      </div>
    );
  }

  const hasVariants = (product.variants?.length ?? 0) > 0;
  const wrap = (region: PageRegionInstance<ProductPageRegionKey>, children: ReactNode) => (
    <ProductRegionShell
      key={region.id}
      region={region}
      selected={region.id === selectedRegionId}
      onSelect={onSelectRegion}
    >
      {children}
    </ProductRegionShell>
  );

  const visibleRegions = regions.filter(
    (region) => region.visible && (region.key !== "variant_selector" || hasVariants),
  );

  return (
    <div
      data-product-preview="ready"
      className={cn(
        storeContainerClassName,
        pageContainerPaddingClass(density),
      )}
    >
      <div className="grid grid-cols-1 gap-6">
        {visibleRegions
          .filter((r) => r.key === "media_gallery")
          .map((region) =>
            wrap(
              region,
              <div className="w-full">
                {product.media.length > 0 ? (
                  <div className="grid gap-2">
                    <div className="aspect-square overflow-hidden rounded-store bg-store-surface-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset */}
                      <img src={product.media[0].url} alt={product.media[0].alt ?? ""} className="size-full object-cover" />
                    </div>
                    {product.media.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {product.media.slice(1, 5).map((m) => (
                          // eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset
                          <img key={m.id} src={m.url} alt={m.alt ?? ""} className="size-14 shrink-0 rounded-store object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    data-product-preview-no-image=""
                    className="grid aspect-square place-items-center rounded-store bg-store-surface-muted text-store-muted-foreground"
                  >
                    <ProductPlaceholderGlyph />
                  </div>
                )}
              </div>,
            ),
          )}

        <div className="min-w-0">
          {visibleRegions.map((region) => {
            switch (region.key) {
              case "media_gallery":
                return null;
              case "identity":
                return wrap(
                  region,
                  <div>
                    {product.categoryName && (
                      <p className="mb-1 text-xs font-medium text-store-muted-foreground">{product.categoryName}</p>
                    )}
                    <h1 className="text-lg font-extrabold leading-snug text-store-foreground md:text-xl">
                      <bdi>{product.name}</bdi>
                    </h1>
                  </div>,
                );
              case "price":
                return wrap(
                  region,
                  <div className="mt-3">
                    <span className="text-xl font-black text-store-primary md:text-2xl">
                      <bdi>{formatMinorAmount(product.priceAmountMinor, product.currency, locale)}</bdi>
                    </span>
                  </div>,
                );
              case "availability":
                return product.inStock === null
                  ? null
                  : wrap(
                      region,
                      <p className="mt-2 text-xs font-medium">
                        {product.inStock ? (
                          <span className="text-store-success">{t("productPreviewInStock")}</span>
                        ) : (
                          <span className="text-store-destructive">{t("productPreviewOutOfStock")}</span>
                        )}
                      </p>,
                    );
              case "variant_selector":
                return !hasVariants
                  ? null
                  : wrap(
                      region,
                      <div className="mt-5 border-t border-store-border pt-5">
                        {(product.options ?? []).map((option) => (
                          <div key={option.id} className="mb-3">
                            <p className="mb-1.5 text-xs font-medium text-store-muted-foreground">{option.name}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {option.values.map((value) => (
                                <span
                                  key={value.id}
                                  className="rounded-store border border-store-border px-2.5 py-1 text-xs text-store-foreground"
                                >
                                  {value.value}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>,
                    );
              case "quantity_cta":
                return wrap(
                  region,
                  <div className="mt-5 border-t border-store-border pt-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-11 w-24 items-center justify-center rounded-store border border-store-border text-sm text-store-foreground">
                        1
                      </span>
                      <span className="flex h-11 min-w-40 flex-1 items-center justify-center rounded-store bg-store-primary text-sm font-bold text-store-primary-foreground">
                        {product.inStock === false ? t("productPreviewOutOfStock") : t("productPreviewAddToCart")}
                      </span>
                    </div>
                  </div>,
                );
              case "description":
                return !product.description
                  ? null
                  : wrap(
                      region,
                      <section className="mt-5 border-t border-store-border pt-5">
                        <h2 className="mb-2 text-sm font-bold text-store-foreground">{t("productPreviewDescriptionTitle")}</h2>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-store-muted-foreground">
                          {product.description}
                        </p>
                      </section>,
                    );
              case "custom_fields":
                // AWJ's own catalog never populates structured custom fields
                // today (Spree-wholesale-only concept) — this region is
                // therefore always an honest omission for a real AWJ
                // Product, exactly like the published `ProductCustomFields`
                // component's own `null` return for an empty list.
                return null;
              case "sku_options_details":
                return !product.sku
                  ? null
                  : wrap(
                      region,
                      <section className="mt-5 border-t border-store-border pt-5">
                        <h2 className="mb-2 text-sm font-bold text-store-foreground">{t("productPreviewDetailsTitle")}</h2>
                        <dl className="space-y-1.5 text-sm">
                          <div className="flex gap-3">
                            <dt className="w-28 shrink-0 text-store-muted-foreground">{t("productPreviewSkuLabel")}</dt>
                            <dd className="min-w-0 text-store-foreground">{product.sku}</dd>
                          </div>
                        </dl>
                      </section>,
                    );
              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
}

function ProductRegionShell({
  region,
  selected,
  onSelect,
  children,
}: {
  region: PageRegionInstance<ProductPageRegionKey>;
  selected: boolean;
  onSelect?: (id: string) => void;
  children: ReactNode;
}) {
  if (!onSelect) return <>{children}</>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-preview-product-region={region.key}
      data-preview-product-region-id={region.id}
      data-region-selected={selected ? "" : undefined}
      onClick={() => onSelect(region.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(region.id);
        }
      }}
      className={cn("awj-preview-section", selected && "awj-preview-section-selected")}
    >
      {children}
    </div>
  );
}

function ProductPlaceholderGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M4 7 12 3l8 4v10l-8 4-8-4z" />
      <path d="M4 7 12 11l8-4M12 11v10" />
    </svg>
  );
}

/**
 * CUST-H2-4 — real structured Category-page preview. Same reasoning as
 * `ProductPagePreview` above: reuses the exact presentation meaning of
 * `CategoryBanner.tsx` (breadcrumbs → title → description → subcategories
 * rail) + `ProductListing.tsx` (filter/sort bar → product grid) via inline
 * JSX and the same `store-*` CSS-variable classes, not a cross-package
 * import. Region order/visibility comes from `regions` (the caller's
 * already-resolved effective list). `description`/`subcategories_rail`
 * honestly omit themselves when the previewed Category has no such data,
 * exactly like the real `CategoryBanner.tsx` does — never fabricating
 * content.
 *
 * **Filter/sort bar is a non-interactive shell** (AWJ Decision — see the
 * implementation report's "Product Grid/Filter-Sort Preview Policy"):
 * rendering the real, authoritative facet/sort UI over editor-context data
 * would let the Customizer fork commerce query/filter semantics it has no
 * authority over (the locked contract explicitly forbids this) — so it
 * shows the real shell labels, disabled, never a fake filter that pretends
 * to work. **Product grid uses real data**: `gridProducts`/`gridProductsTotal`
 * come from the same authoritative Workspace Product API H2-3 built,
 * filtered by this Category's own id (`category_id`) — the identical
 * membership + publication gate the public Commerce API already applies —
 * never a client-filtered slice of an unrelated list and never a fabricated
 * count.
 */
function CategoryPagePreview({
  locale,
  density,
  productCard,
  state,
  category,
  regions,
  selectedRegionId,
  onSelectRegion,
  gridProductsState,
  gridProducts,
  gridProductsTotal,
}: {
  locale: CustomizerLocale;
  density: "compact" | "comfortable";
  productCard: ProductCardStyleId;
  state: "idle" | "loading" | "error" | "empty" | "ready";
  category: WorkspaceCategoryDetail | null;
  regions: PageRegionInstance<CategoryPageRegionKey>[];
  selectedRegionId?: string | null;
  onSelectRegion?: (id: string) => void;
  gridProductsState?: "idle" | "loading" | "error" | "ready";
  gridProducts?: { id: string; name: string; thumbnailUrl: string | null }[];
  gridProductsTotal?: number;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  if (state !== "ready" || category === null) {
    const bodyKey: CustomizerMessageKey =
      state === "loading"
        ? "categoryPreviewLoading"
        : state === "error"
          ? "categoryPreviewLoadFailed"
          : state === "empty"
            ? "categoryPreviewNoEligibleCategories"
            : "categoryPreviewSelectACategory";
    return (
      <div
        data-category-preview-state={state}
        className={cn(
          storeContainerClassName,
          density === "compact" ? "py-10" : "py-14 md:py-20",
        )}
      >
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-store-surface-muted text-store-muted-foreground">
            <PageIcon page="category" />
          </span>
          <p className="text-sm leading-6 text-store-muted-foreground">{t(bodyKey)}</p>
        </div>
      </div>
    );
  }

  const wrap = (region: PageRegionInstance<CategoryPageRegionKey>, children: ReactNode) => (
    <CategoryRegionShell
      key={region.id}
      region={region}
      selected={region.id === selectedRegionId}
      onSelect={onSelectRegion}
    >
      {children}
    </CategoryRegionShell>
  );

  const visibleRegions = regions.filter((region) => region.visible);

  return (
    <div
      data-category-preview="ready"
      className={cn(
        storeContainerClassName,
        density === "compact" ? "space-y-3" : "space-y-4",
        pageContainerPaddingClass(density),
      )}
    >
      {visibleRegions.map((region) => {
        switch (region.key) {
          case "breadcrumbs":
            return wrap(
              region,
              <nav aria-label={category.name} className="flex flex-wrap items-center gap-1 text-xs text-store-muted-foreground">
                {category.ancestors.map((ancestor) => (
                  <span key={ancestor.id} className="flex items-center gap-1">
                    <bdi className="truncate">{ancestor.name}</bdi>
                    <span aria-hidden="true">/</span>
                  </span>
                ))}
                <bdi className="truncate font-medium text-store-foreground">{category.name}</bdi>
              </nav>,
            );
          case "identity_title":
            return wrap(
              region,
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary" />
                <h1 className="text-base font-extrabold leading-tight text-store-foreground md:text-lg">
                  <bdi>{category.name}</bdi>
                </h1>
              </div>,
            );
          case "description":
            return !category.description
              ? null
              : wrap(
                  region,
                  <p className="text-xs text-store-muted-foreground md:text-sm">{category.description}</p>,
                );
          case "subcategories_rail":
            return category.children.length === 0
              ? null
              : wrap(
                  region,
                  <nav aria-label={category.name} className="store-rail flex gap-1.5 overflow-x-auto pb-1">
                    {category.children.map((child) => (
                      <span
                        key={child.id}
                        className="shrink-0 rounded-store border border-store-border bg-store-surface px-3 py-1.5 text-xs font-medium text-store-foreground"
                      >
                        <bdi>{child.name}</bdi>
                      </span>
                    ))}
                  </nav>,
                );
          case "filter_sort_bar":
            return wrap(
              region,
              <div className="flex items-center justify-between gap-2 border-t border-store-border pt-3 text-xs text-store-muted-foreground">
                <span aria-hidden="true" className="rounded-store border border-store-border px-2.5 py-1">
                  {t("categoryPreviewFilterLabel")}
                </span>
                <span aria-hidden="true" className="rounded-store border border-store-border px-2.5 py-1">
                  {t("categoryPreviewSortLabel")}
                </span>
              </div>,
            );
          case "product_grid":
            return wrap(
              region,
              gridProductsState === "loading" ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="aspect-[3/4] animate-pulse rounded-store bg-store-surface-muted" />
                  ))}
                </div>
              ) : !gridProductsTotal ? (
                <p data-category-preview-no-products="" className="py-6 text-center text-xs text-store-muted-foreground">
                  {t("categoryPreviewNoProducts")}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {(gridProducts ?? []).map((product) => (
                    <div key={product.id} className="overflow-hidden rounded-store bg-store-surface-muted">
                      <div className="aspect-square">
                        {product.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tenant media URL, not a static asset
                          <img src={product.thumbnailUrl} alt="" className="size-full object-cover" />
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          "truncate text-[11px] text-store-foreground",
                          productCard === "compact" ? "px-1.5 py-1" : "px-2 py-1.5",
                        )}
                      >
                        <bdi>{product.name}</bdi>
                      </p>
                    </div>
                  ))}
                </div>
              ),
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function CategoryRegionShell({
  region,
  selected,
  onSelect,
  children,
}: {
  region: PageRegionInstance<CategoryPageRegionKey>;
  selected: boolean;
  onSelect?: (id: string) => void;
  children: ReactNode;
}) {
  if (!onSelect) return <>{children}</>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-preview-category-region={region.key}
      data-preview-category-region-id={region.id}
      data-region-selected={selected ? "" : undefined}
      onClick={() => onSelect(region.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(region.id);
        }
      }}
      className={cn("awj-preview-section", selected && "awj-preview-section-selected")}
    >
      {children}
    </div>
  );
}

function SelectablePreviewSection({
  sectionKey,
  sectionId,
  selected,
  onSelect,
  children,
}: {
  sectionKey: string;
  sectionId: string;
  selected: boolean;
  onSelect?: (id: string) => void;
  children: ReactNode;
}) {
  if (!onSelect) return <>{children}</>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-preview-section={sectionKey}
      data-preview-section-id={sectionId}
      data-section-selected={selected ? "" : undefined}
      onClick={() => onSelect(sectionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(sectionId);
        }
      }}
      className={cn(
        "awj-preview-section",
        selected && "awj-preview-section-selected",
      )}
    >
      {children}
    </div>
  );
}

function SectionRule({ title, action }: { title: string; action: string }) {
  return (
    <div data-section-heading="" className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden
          data-heading-bar=""
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:h-5"
        />
        <h2 className="text-base font-extrabold leading-tight text-store-foreground md:text-lg">
          {title}
        </h2>
      </div>
      <span data-section-action="" className="text-xs font-bold text-store-primary md:text-sm">{action}</span>
    </div>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-store-footer-foreground">{title}</h2>
      <div className="mt-4 space-y-2.5 text-sm">{children}</div>
    </div>
  );
}

function pageTitleKey(
  slug: StorefrontPresentationConfig["pages"][number]["slug"],
): CustomizerMessageKey {
  switch (slug) {
    case "about":
      return "pageAbout";
    case "contact":
      return "pageContact";
    case "faq":
      return "pageFaq";
    case "shipping-policy":
      return "pageShipping";
    case "privacy-policy":
      return "pagePrivacy";
    case "returns-policy":
      return "pageReturns";
    default:
      return "pageTerms";
  }
}

function socialLabel(
  t: (key: CustomizerMessageKey) => string,
  network: string,
): string {
  switch (network) {
    case "instagram":
      return t("socialInstagram");
    case "x":
      return t("socialX");
    case "tiktok":
      return t("socialTiktok");
    case "snapchat":
      return t("socialSnapchat");
    case "youtube":
      return t("socialYoutube");
    case "linkedin":
      return t("socialLinkedin");
    case "facebook":
      return t("socialFacebook");
    default:
      return network;
  }
}
