"use client";

import {
  ANNOUNCEMENT_PREVIEW_HEIGHT,
  AnnouncementPreview,
  announcementBarVisible,
} from "./AnnouncementPreview";
import { Eye, Home, LayoutGrid, Search, ShoppingBag, User } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
import { HeaderOverlayPreview } from "./HeaderOverlayPreview";
import { HeaderScrollUpPreview } from "./HeaderScrollUpPreview";
import { CanvasFooter } from "./CanvasFooter";
import { CanvasNavItem, canvasNavItems } from "./CanvasNav";
import { mainMenu } from "./presentation/navigation";
import type { PresentationHomeSection } from "./presentation/config";
import { canDeleteSection, canDuplicateSection } from "./presentation/section-capabilities";
import { sectionIsAuthored } from "./presentation/section-ops";
import { overlayMarker, resolveHeaderOverlay } from "./presentation/header-overlay";
import { headerIsCompact, resolveHeaderDesign } from "./presentation/header-design";
import type { CategoryPageRegionKey, PageRegionInstance, PageType, ProductPageRegionKey } from "./presentation/page-regions";
import type { WorkspaceProductDetail } from "@/modules/commerce-workspace/workspace-products";
import type { WorkspaceCategoryDetail } from "@/modules/commerce-workspace/workspace-categories";
import { displayLocale } from "@/lib/formatting";
import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import type { WorkspaceDeliveryEarliest, WorkspaceDiscoveryData } from "@/modules/commerce-workspace/workspace-section-data";
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
import { ctaPaint, effectiveCtaStyle } from "./presentation/cta-colour";
import {
  type CtaStyle,
  bannerContentOf,
  bannerCtasOf,
  heroContentOf,
  benefitsContentOf,
  customContentOf,
  featuredContentOf,
  newArrivalsContentOf,
  deliveryPromiseContentOf,
  discoveryContentOf,
  offersContentOf,
  productShelfContentOf,
  galleryContentOf,
  sliderContentOf,
} from "./presentation/section-content";
import {
  buildWhatsAppUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  sanitizeExternalUrl,
} from "./presentation/urls";
import { cn } from "@/lib/utils";

/** Signed preview media must fail closed when a URL expires or is revoked. */
function PreviewMediaImage({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed tenant media URL
    <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}
import { SbcSeal } from "./SbcSeal";
import {
  customizerMessage,
  type CustomizerLocale,
  type CustomizerMessageKey,
} from "./messages";
import { CanvasBackdrop } from "./media/CanvasBackdrop";
import { CanvasContentBlocks, Selectable } from "./CanvasContentBlocks";
import { SectionActionBar, type CanvasSectionActions, type CanvasSectionEligibility } from "./CanvasSectionActions";
import { CanvasGallery } from "./CanvasGallery";
import { CanvasSlider } from "./CanvasSlider";
import { useBackgroundMediaBounds } from "./media/use-background-media-bounds";
import { announcementWindowState } from "./presentation/announcements";
import { useWindowsClock } from "./use-announcement-clock";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import { fontFamilyStack } from "./presentation/font-catalogue";
import { resolveGlobalTokens } from "./presentation/global-tokens";
import type { HeadingBlock, ParagraphBlock } from "./presentation/content-blocks";
import { StoreIcon } from "./StoreIcon";
import type { BenefitsLayout, SectionDesign } from "./presentation/section-design";
import { resolveSectionDesign } from "./presentation/section-design-resolve";
import { resolveDiscoveryDisplay } from "./presentation/discovery-templates";
import { resolveFacetValueVisual, type ResolvedFacetVisual } from "./presentation/facet-visual";
import { FacetVisualTile } from "./FacetVisualTile";
import { formatDeliveryDay, formatDeliveryWindow } from "./presentation/delivery-format";
import { SectionDesignFrame } from "./SectionDesignFrame";
import type { DesignContext } from "./presentation/section-design-resolve";
import { PREVIEW_STORE_NAME } from "./preview-fixtures";
import { CanvasCategoryDisplay } from "./CanvasCategoryDisplay";
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
  /** CUST-HV V8c — the slide each slider section shows (the editor's selection), by section id; browsing in the Canvas reports back. */
  activeSlides?: Record<string, string>;
  onActiveSlideChange?: (sectionId: string, slideId: string) => void;
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
  categoryGridProducts?: { id: string; name: string; thumbnailUrl: string | null; priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean }[];
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
  homeCategories?: { id: string; name: string; imageUrl?: string | null; color?: string | null }[];
  onRetryHomeCategories?: () => void;
  /**
   * CUST-H4-3 — the Home "newArrivals" section's own real Canvas preview:
   * the storefront's real most-recently-created eligible products, ordered
   * the same way Published's own `NewArrivals.tsx` orders them
   * (`-available_on` → `created_at` desc), replacing the static
   * `PREVIEW_PRODUCTS` fixture this branch used before.
   */
  homeNewArrivalsState?: "idle" | "loading" | "error" | "ready";
  homeNewArrivals?: { id: string; name: string; thumbnailUrl: string | null; priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean }[];
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
  featuredResolved?: Record<string, { id: string; name: string; thumbnailUrl: string | null; priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean }[]>;
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
  /**
   * CUST-HV V10d — the hover action bar (move / hide / duplicate / delete) on each Home section. Absent on a Published Version, in
   * Theme Preview and in the dev harness: no bar is drawn.
   */
  sectionActions?: CanvasSectionActions;
  onRetryOffers?: () => void;
  /** FLOWERS-H9c — authoritative live data for the three data-backed home sections. */
  homeSectionProducts?: Record<string, { id: string; name: string; nameEn?: string | null; thumbnailUrl: string | null; priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean }[]>;
  homeSectionProductsState?: Record<string, "idle" | "loading" | "error" | "ready">;
  homeSectionDiscovery?: Record<string, WorkspaceDiscoveryData | null>;
  homeSectionDiscoveryState?: Record<string, "idle" | "loading" | "error" | "ready">;
  homeSectionDelivery?: Record<string, WorkspaceDeliveryEarliest | null>;
  homeSectionDeliveryState?: Record<string, "idle" | "loading" | "error" | "ready">;
  onRetryHomeDataSection?: (sectionId: string) => void;
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

/** Stable empty list: no homepage sections to read picture bounds for. */
const NO_SECTIONS: ReadonlyArray<{ visible: boolean; design?: SectionDesign }> = [];
const NO_WINDOWS: ReadonlyArray<undefined> = [];

// CUST-HV V6c-5 — the looks of a hero / banner button, the same as the storefront's `HeroSection` / `BannerBand`
// (one source of colour: the section's own foreground, so a style adds no contrast surface).
const HERO_CTA_LOOK: Record<CtaStyle, string> = {
  solid: "bg-store-primary-foreground text-store-primary",
  outline: "border-2 border-store-primary-foreground/70 text-store-primary-foreground",
  link: "px-1 text-store-primary-foreground underline decoration-2 underline-offset-4 md:px-2",
  // `soft` only exists with a colour; without one it keeps the section's primary look (as the storefront)
  soft: "bg-store-primary-foreground text-store-primary",
};
// CUST-HV V6c-6 — a button with an explicit `colour` is painted from three validated custom properties.
const COLOURED_CTA_HERO = "border-2 border-(color:--cta-border) bg-(color:--cta-fill) text-(color:--cta-label)";
const COLOURED_CTA_BANNER =
  "inline-flex h-10 max-w-full items-center rounded-store border-2 border-(color:--cta-border) bg-(color:--cta-fill) px-4 text-sm font-bold text-(color:--cta-label)";
const COLOURED_LINK = "px-1 underline decoration-2 underline-offset-4";
function ctaPaintVars(paint: { fill: string; label: string; border: string } | null): CSSProperties | undefined {
  return paint
    ? ({ "--cta-fill": paint.fill, "--cta-label": paint.label, "--cta-border": paint.border } as CSSProperties)
    : undefined;
}
const BANNER_CTA_CLASS: Record<CtaStyle, string> = {
  solid:
    "inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground",
  outline:
    "inline-flex h-10 max-w-full items-center rounded-store border-2 border-store-foreground/60 px-4 text-sm font-bold text-store-foreground",
  link: "inline-flex h-10 max-w-full items-center px-1 text-sm font-bold text-store-foreground underline decoration-2 underline-offset-4",
  soft: "inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground",
};

/**
 * CUST-HV V9d-2 — the attributes a product / offer shelf carries once the merchant chose a `layout` or `columns` in its design: the closed-list
 * values and the simulated device, which the Canvas-only block of `store-preview.css` turns into the storefront's own column / rail numbers.
 * No choice ⇒ no attributes ⇒ the legacy preview, byte for byte.
 */
function shelfAttrs(design: SectionDesign | undefined, viewport: "desktop" | "tablet" | "mobile"): Record<string, string> {
  if (!design?.layout && !design?.columns) return {};
  return {
    "data-shelf": design.layout === "rail" ? "rail" : "grid",
    "data-vp": viewport,
    ...(design.columns ? { "data-cols": String(design.columns) } : {}),
  };
}

function discoveryOptionImage(visual: Record<string, unknown> | null): string | null {
  const image = visual?.image;
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;
  const sources = (image as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return null;
  const source = sources.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).src === "string");
  return source && typeof (source) === "object" ? (source as Record<string, string>).src ?? null : null;
}

function discoveryOptionSources(visual: Record<string, unknown> | null): { src: string; srcSet?: string } | null {
  const image = visual?.image;
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;
  const sources = (image as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return null;
  const valid = sources.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    return typeof source.src === "string" && typeof source.width === "number"
      ? [{ src: source.src, width: source.width }]
      : [];
  });
  if (valid.length === 0) return null;
  const ordered = [...valid].sort((a, b) => a.width - b.width);
  return { src: ordered[ordered.length - 1].src, srcSet: ordered.map((source) => `${source.src} ${source.width}w`).join(", ") };
}

function resolvedDiscoveryVisual(
  discovery: WorkspaceDiscoveryData,
  option: WorkspaceDiscoveryData["options"][number],
  display: ReturnType<typeof resolveDiscoveryDisplay>,
  layout: string | null,
): ResolvedFacetVisual {
  const optionImage = option.visual && typeof option.visual.image === "object" && option.visual.image !== null && !Array.isArray(option.visual.image)
    ? option.visual.image as Record<string, unknown>
    : null;
  const optionMediaId = typeof optionImage?.mediaId === "string" ? optionImage.mediaId : null;
  const resolution = resolveFacetValueVisual(discovery.visual ?? {}, option.visual ?? {}, {
    section: display.visualSection,
    template: display.visualTemplate,
    usableMediaIds: optionMediaId && discoveryOptionImage(option.visual) ? [optionMediaId] : [],
  });
  let visual = resolution.visual;
  if (visual.content === "none" && (resolution.sources.content === "system" || resolution.sources.fallback !== null)) {
    visual = { ...visual, content: "icon" };
  }
  if (layout === "icon-grid") {
    const icon = visual.content === "icon" ? visual.icon : visual.content === "image" ? visual.fallbackIcon : undefined;
    if (icon) {
      const { image: _image, fallbackIcon: _fallback, ...rest } = visual;
      visual = { ...rest, content: "icon", icon };
    }
  }
  return visual;
}

function discoveryGridColumnsClass(columns: number): string {
  const classes: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
    8: "grid-cols-8",
  };
  return classes[Math.max(1, columns)] ?? "grid-cols-2";
}

export function StorefrontPreviewCanvas({
  config,
  locale,
  viewport,
  page = "home",
  liveStoreName = null,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  selectedSection = null,
  onSelectSection,
  activeSlides,
  onActiveSlideChange,
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
  sectionActions,
  onRetryOffers,
  homeSectionProducts = {},
  homeSectionProductsState = {},
  homeSectionDiscovery = {},
  homeSectionDiscoveryState = {},
  homeSectionDelivery = {},
  homeSectionDeliveryState = {},
  onRetryHomeDataSection,
}: StorefrontPreviewCanvasProps) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const storeName = previewStoreName(
    config,
    liveStoreName,
    PREVIEW_STORE_NAME[locale],
  );
  // CUST-HV V6a — the first visible hero carries the page's one <h1>.
  const firstHeroId = config.homepage.sections.find(
    (section) => section.visible && section.type === "hero",
  )?.id;
  // CUST-HV V5e-2a — document-level global tokens: the same pure resolver the published
  // theme wrapper uses (absent ⇒ nothing is added).
  const globalTokens = resolveGlobalTokens(config, config);
  const vars = {
    ...presentationCssVars(config.primaryColor, config.radius, config.accentColor, config.backgroundColor),
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
  const headerStyleCompact = headerIsCompact(config.header);
  // CUST-HV V7a — structural header design (absent ⇒ every branch below is the old markup).
  const headerResolved = resolveHeaderDesign(config.header.design, config);
  const headerDesign = config.header.design;
  const headerRowMinHeight = headerDesign?.height
    ? mobileViewport
      ? { compact: "2.875rem", standard: "3.375rem", tall: "3.875rem" }[headerDesign.height]
      : { compact: "3.25rem", standard: "4rem", tall: "5rem" }[headerDesign.height]
    : undefined;
  const headerLogoStart = mobileViewport && headerResolved.mobileLayout === "logo-start";
  const desktopLayout = mobileViewport ? "standard" : headerResolved.layout;
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
  // CUST-HV V6b-4a — the proven bounds of every picture background (read-only, from the server), so
  // the Canvas decides exactly like the publish gate and the published storefront.
  // Only the home preview renders these sections: another page must not read their statuses.
  const backgroundBounds = useBackgroundMediaBounds(page === "home" ? config.homepage.sections : NO_SECTIONS);
  // CUST-HV V6c-1 — Banner display windows. The storefront omits a banner outside its window; the
  // Canvas keeps it visible and editable and says so instead (the merchant must always be able to
  // select what they are scheduling). Same predicate as the storefront, one clock, home page only.
  const bannerWindowsNow = useWindowsClock(
    page === "home"
      ? config.homepage.sections.map((section) => (section.type === "banner" ? bannerContentOf(section).window : undefined))
      : NO_WINDOWS,
  );
  const designContext: DesignContext = {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    pageBackground: config.backgroundColor,
    palette: config.palette,
    dir: locale === "ar" ? "rtl" : "ltr",
    mediaBounds: backgroundBounds.lookup,
    // V6c-3 — "screen height" means the SIMULATED device's height here, not the editor window's.
    screenHeightPx: viewport === "mobile" ? 844 : viewport === "tablet" ? 1024 : 800,
    // V6c-4 — overlap is a ≥ md effect: a simulated phone shows none, whatever the editor window's width.
    simulatedWidthPx: viewport === "mobile" ? 390 : viewport === "tablet" ? 768 : 1280,
  };
  /** The picture layer of a section whose design resolves a *proven* picture background, else nothing. */
  const backdropFor = (section: (typeof config.homepage.sections)[number]): ReactNode => {
    const bg = section.design?.background;
    if (bg?.kind !== "media") return null;
    const resolved = resolveSectionDesign(section.type, section.design, designContext);
    if (!resolved?.attrs["data-sd"]?.split(" ").includes("mbg")) return null;
    return <CanvasBackdrop background={bg} viewport={viewport} motionLabels={{ pause: t("canvasMotionPause"), play: t("canvasMotionPlay") }} />;
  };
  // CUST-HV V7c-2 — the same decision the published Home makes: opted in, first visible section a proven full-picture
  // hero, picture really rendered (the resolver emitted `mbg`) — else the header stays solid.
  const overlayDecision = resolveHeaderOverlay(config.header.design, config.homepage.sections, designContext);
  const overlayHero =
    page === "home" && overlayDecision && "overlay" in overlayDecision
      ? (() => {
          const section = config.homepage.sections.find((s) => s.id === overlayDecision.overlay.sectionId);
          return section && backdropFor(section) ? overlayDecision.overlay : null;
        })()
      : null;
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
  const shownHomeCategories = homeCategories.slice(0, isMarket ? 18 : 12);
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
  // V7d: a `main` menu supersedes the legacy flat `header.links` (V0 §11.1).
  const publishedMain = mainMenu(config.navigation);
  const mainNavItems = publishedMain ? canvasNavItems(publishedMain) : null;
  const extraNav = (publishedMain ? [] : config.header.links).filter((link) => {
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
      {...(headerResolved.attrs ?? {})}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={cn(
        "awj-store-preview relative min-h-full bg-store-background text-store-foreground",
        PREVIEW_FONT_VARIABLES,
      )}
      style={{
        ...vars,
        ...(headerResolved.style ?? {}),
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
          headerResolved.sticky === "off" ? "relative z-20" : "sticky top-0 z-20",
          "bg-store-surface",
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
        {headerResolved.sticky === "on-scroll-up" ? <HeaderScrollUpPreview /> : null}
        {headerResolved.overlay ? <HeaderOverlayPreview sticky={headerResolved.sticky !== "off"} /> : null}
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

        <div
          className="border-b border-store-border"
          {...(headerResolved.designed ? { "data-header-row": "" } : {})}
        >
          <div
            style={headerRowMinHeight ? { minHeight: headerRowMinHeight } : undefined}
            className={cn(
              storeContainerClassName,
              mobileViewport
                ? cn(
                    "grid items-center gap-2 py-2",
                    headerLogoStart
                      ? "grid-cols-[auto_minmax(0,1fr)_auto]"
                      : "grid-cols-[1fr_minmax(0,1fr)_1fr]",
                  )
                : desktopLayout === "centered"
                  ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 py-3"
                  : desktopLayout === "two-row"
                    ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 py-3"
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
                mobileViewport && (headerLogoStart ? "justify-self-start" : "justify-self-center"),
                desktopLayout === "centered" && "col-start-2 row-start-1 justify-self-center",
              )}
            >
              <StoreBrand
                href="#preview"
                name={storeName}
                size="md"
                logoUrl={logo}
                linked={!onSelectChrome}
                scale={headerResolved.logoSize}
                mobile={mobileViewport}
                headerBrand={headerResolved.designed}
              />
            </button>
            {config.header.showSearch && !mobileViewport && (
              <div
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-store border border-store-border bg-store-surface px-3 text-sm text-store-muted-foreground",
                  desktopLayout === "centered" && "col-start-1 row-start-1 max-w-2xl",
                  desktopLayout === "two-row" && "order-last col-span-2",
                  desktopLayout === "standard" && "flex-1",
                )}
              >
                <Search className="size-4" aria-hidden />
                {t("search")}
              </div>
            )}
            <div
              className={cn(
                "flex items-center gap-1",
                mobileViewport && "justify-self-end",
                desktopLayout === "centered" && "col-start-3 row-start-1 justify-self-end",
                desktopLayout === "two-row" && "justify-self-end",
              )}
            >
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

        {(config.header.showCategoryNav || extraNav.length > 0 || (mainNavItems?.length ?? 0) > 0) && !mobileViewport && (
          <nav
            aria-label={t("sectionCategories")}
            className="border-b border-store-border bg-store-surface-muted"
          >
            <div className={cn(storeContainerClassName, "flex h-9 items-center gap-4 overflow-x-clip text-sm")}>
              {config.header.showCategoryNav ? (
                <>
                  <span className="rounded-md bg-store-surface px-2 py-1 font-medium text-store-foreground">
                    {t("allProducts")}
                  </span>
                  {homeCategories.map((category) => (
                    <span key={category.id} className="text-store-muted-foreground">
                      {category.name}
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
              {mainNavItems?.map((item) => (
                <CanvasNavItem key={item.id} item={item} />
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
              // Each hero reads its OWN content; without any it keeps reading the legacy globals.
              const own = heroContentOf(section);
              const title =
                (own ? own.headline.trim() : config.homepage.heroHeadline.trim()) || storeName;
              const sub = own
                ? (own.subheadline ?? "").trim()
                : config.homepage.heroSubheadline.trim();
              // only a COMPLETE call to action renders (a draft with a label but no link — or the
              // reverse — is kept in the document but not shown, and never brings the default CTA
              // back: that is for a hero with NO authored buttons — exactly as the storefront)
              const hasAuthoredCtas = (own?.ctas?.length ?? 0) > 0;
              const ctas = (own?.ctas ?? []).filter(
                (cta) =>
                  cta.label.trim() !== "" &&
                  (cta.href.startsWith("/") || cta.href.startsWith("https://")),
              );
              // exactly one <h1> per page: the first visible hero; any further one is an <h2>
              const Heading = section.id === firstHeroId ? "h1" : "h2";
              return (
                <section
                  key={section.id}
                  aria-label={t("sectionHero")}
                  className="flex min-h-[11rem] items-center rounded-store bg-gradient-to-r from-primary-700 via-primary-600 to-primary-500 text-store-primary-foreground md:min-h-[16rem]"
                >
                  {backdropFor(section)}
                  <div data-section-content="" className="max-w-2xl p-5 md:p-10">
                    <Heading
                      data-preview-hero-heading=""
                      className="text-xl font-black leading-tight sm:text-2xl lg:text-4xl"
                    >
                      <bdi>{title}</bdi>
                    </Heading>
                    {sub ? (
                      <p className="mt-2 line-clamp-2 text-xs text-store-primary-foreground/80 md:mt-3 md:text-sm">
                        {sub}
                      </p>
                    ) : null}
                    {!hasAuthoredCtas ? (
                      <span className="mt-4 inline-flex h-9 items-center rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary md:mt-5 md:h-11 md:px-6 md:text-sm">
                        {t("shopNow")}
                      </span>
                    ) : ctas.length === 0 ? null : (
                      <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-5 md:gap-3">
                        {ctas.map((cta, index) => (
                          <span
                            key={`${index}-${cta.href}`}
                            data-preview-hero-cta={index === 0 ? "primary" : "secondary"}
                            data-cta-style={effectiveCtaStyle(cta.style, index)}
                            data-cta-colour={cta.colour}
                            style={ctaPaintVars(cta.colour ? ctaPaint(effectiveCtaStyle(cta.style, index), cta.colour, designContext) : null)}
                            className={cn(
                              "inline-flex h-9 items-center rounded-store px-4 text-xs font-bold md:h-11 md:px-6 md:text-sm",
                              cta.colour
                                ? [COLOURED_CTA_HERO, effectiveCtaStyle(cta.style, index) === "link" && COLOURED_LINK]
                                : HERO_CTA_LOOK[effectiveCtaStyle(cta.style, index)],
                            )}
                          >
                            {cta.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              );
            }

            if (section.type === "categories") {
              return (
                <section key="categories" aria-labelledby="preview-categories">
                  <SectionRule
                    title={t("browseCategories")}
                    action={homeCategories.length > shownHomeCategories.length ? t("viewAll") : undefined}
                  />
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
                  ) : section.design?.display ? (
                    // AWJ-STORE-CAT-DESIGN-01 — the merchant chose a card display: the storefront's own resolver, view and
                    // stylesheet, pinned to the simulated device. Without one the classic preview tiles below are untouched.
                    <CanvasCategoryDisplay
                      display={section.design.display}
                      categories={shownHomeCategories}
                      viewport={viewport}
                      dir={locale === "ar" ? "rtl" : "ltr"}
                    />
                  ) : (
                    <ul className={cn("mt-4 grid", categoriesGap, categoriesColumns)}>
                      {shownHomeCategories.map((category) => (
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
              const arrivalsOwn = newArrivalsContentOf(section);
              return (
                <section key="newArrivals" aria-labelledby="preview-arrivals">
                  <SectionRule
                    title={arrivalsOwn.title ?? t("newArrivals")}
                    hideTitle={arrivalsOwn.showTitle === false}
                    action={t("viewAll")}
                  />
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
                          <div data-card-body="" className={cardPad}>
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
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)} {...shelfAttrs(section.design, viewport)}>
                      {homeNewArrivals.map((product) => (
                        <li
                          key={product.id}
                          data-card=""
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div
                            data-card-image=""
                            className={cn(
                              cardImageHeight,
                              "relative bg-store-surface-muted",
                            )}
                          >
                            {product.thumbnailUrl ? (
                              <PreviewMediaImage
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
                          <div data-card-body="" className={cardPad}>
                            <p className="line-clamp-2 text-sm font-semibold text-store-foreground">
                              <bdi>{product.name}</bdi>
                            </p>
                            <PreviewProductMeta product={product} locale={locale} />
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

            if (section.type === "slider") {
              // CUST-HV V8c — the same `data-slider` DOM and per-slide decision as the storefront (`slideDraw`, fed by the proven bounds).
              const slider = sliderContentOf(section);
              return (
                <CanvasSlider
                  key={section.id}
                  slides={slider.slides}
                  behaviour={slider.behaviour}
                  context={designContext}
                  viewport={viewport}
                  activeSlideId={activeSlides?.[section.id] ?? null}
                  onActiveSlideChange={(slideId) => onActiveSlideChange?.(section.id, slideId)}
                  labels={{
                    label: t("canvasSliderLabel"),
                    slide: t("canvasSliderSlide"),
                    previous: t("canvasSliderPrevious"),
                    next: t("canvasSliderNext"),
                    goTo: t("canvasSliderGoTo"),
                    empty: t("canvasSliderEmpty"),
                    autoplayNote: t("canvasSliderAutoplayNote"),
                    motion: { pause: t("canvasMotionPause"), play: t("canvasMotionPlay") },
                  }}
                />
              );
            }

            if (section.type === "gallery") {
              // CUST-HV V8f — the same `data-gallery` DOM as the storefront; the layout is the section design's (`carousel`, else the grid).
              const gallery = galleryContentOf(section);
              return (
                <CanvasGallery
                  key={section.id}
                  images={gallery.images}
                  options={gallery.options}
                  layout={section.design?.layout === "carousel" ? "carousel" : "grid"}
                  dir={designContext.dir}
                  viewport={viewport}
                  activeImageId={activeSlides?.[section.id] ?? null}
                  labels={{
                    label: t("canvasGalleryLabel"),
                    empty: t("canvasGalleryEmpty"),
                    item: t("canvasGalleryItem"),
                  }}
                />
              );
            }

            if (section.type === "banner") {
              const banner = bannerContentOf(section);
              // CUST-HV V6c-2 — `ctas` when authored, else the legacy pair (= ctas[0]); only a complete button renders.
              const bannerCtas = bannerCtasOf(banner);
              const empty =
                !banner.title &&
                !banner.subtitle &&
                !bannerCtas.some((cta) => cta.label.trim() !== "") &&
                !banner.imageUrl;
              const completeCtas = bannerCtas
                .map((cta) => ({ label: cta.label.trim(), href: cta.href, style: cta.style, colour: cta.colour }))
                .filter((cta) => cta.label !== "" && (cta.href.startsWith("https://") || cta.href.startsWith("/")));
              const windowState =
                bannerWindowsNow === null || !banner.window ? null : announcementWindowState(banner.window, bannerWindowsNow);
              return (
                <section key={section.id} className="overflow-hidden rounded-store border border-store-border bg-store-surface">
                  {backdropFor(section)}
                  {windowState !== "open" && windowState !== null ? (
                    <p
                      data-banner-window-status={windowState}
                      role="status"
                      className="relative z-10 border-b border-store-border bg-store-background px-5 py-1.5 text-xs font-medium text-store-muted-foreground"
                    >
                      {t(windowState === "scheduled" ? "bannerWindowScheduled" : windowState === "expired" ? "bannerWindowExpired" : "bannerWindowInvalid")}
                    </p>
                  ) : null}
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
                        {completeCtas.length === 1 ? (
                          <span
                            data-banner-cta=""
                            data-cta-style={effectiveCtaStyle(completeCtas[0].style, 0)}
                            data-cta-colour={completeCtas[0].colour}
                            style={ctaPaintVars(
                              completeCtas[0].colour ? ctaPaint(effectiveCtaStyle(completeCtas[0].style, 0), completeCtas[0].colour, designContext) : null,
                            )}
                            {...(completeCtas[0].colour || completeCtas[0].style === "outline"
                              ? { "data-slot": "button", "data-variant": "outline" }
                              : {})}
                            className={cn(
                              "mt-4",
                              completeCtas[0].colour
                                ? [COLOURED_CTA_BANNER, effectiveCtaStyle(completeCtas[0].style, 0) === "link" && COLOURED_LINK]
                                : BANNER_CTA_CLASS[effectiveCtaStyle(completeCtas[0].style, 0)],
                            )}
                          >
                            <span className="min-w-0 truncate">{completeCtas[0].label}</span>
                          </span>
                        ) : completeCtas.length > 1 ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            {completeCtas.map((cta, index) => (
                              <span
                                key={`${index}-${cta.href}`}
                                data-banner-cta=""
                                data-cta-style={effectiveCtaStyle(cta.style, index)}
                                data-cta-colour={cta.colour}
                                style={ctaPaintVars(cta.colour ? ctaPaint(effectiveCtaStyle(cta.style, index), cta.colour, designContext) : null)}
                                // an outline (or coloured) button is the shared Button's outline variant for the global button tokens
                                {...(cta.colour || effectiveCtaStyle(cta.style, index) === "outline"
                                  ? { "data-slot": "button", "data-variant": "outline" }
                                  : {})}
                                className={
                                  cta.colour
                                    ? cn(COLOURED_CTA_BANNER, effectiveCtaStyle(cta.style, index) === "link" && COLOURED_LINK)
                                    : BANNER_CTA_CLASS[effectiveCtaStyle(cta.style, index)]
                                }
                              >
                                <span className="min-w-0 truncate">{cta.label}</span>
                              </span>
                            ))}
                          </div>
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
              const benefitsLayout = section.design?.layout as BenefitsLayout | undefined;
              const benefitsFlat = benefitsLayout === "flat";
              return (
                <section key={section.id} data-section-block={designed ? "" : undefined} data-benefits={benefitsLayout ?? "auto"} data-vp={viewport}>
                  <h2 className="text-base font-extrabold">{t("sectionBenefits")}</h2>
                  {items.length === 0 ? (
                    <p className="mt-2 text-sm text-store-muted-foreground">{t("sectionBenefits")}</p>
                  ) : (
                    <ul className={cn("mt-3 grid", benefitsFlat ? "gap-x-6 gap-y-5" : "gap-2")}>
                      {items.map((item) => (
                        <li
                          key={item.id}
                          data-benefit-item=""
                          className={cn(
                            "flex min-w-0 items-start gap-3 break-words",
                            benefitsFlat ? null : cn("rounded-store border border-store-border", designed ? "bg-store-surface px-4 py-4" : "px-3 py-3"),
                          )}
                        >
                          {item.icon ? (
                            <span
                              data-benefit-icon=""
                              className="flex size-10 shrink-0 items-center justify-center rounded-store border border-store-border text-store-foreground"
                            >
                              <StoreIcon name={item.icon} className="size-5" />
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            {item.title ? <p className="break-words text-sm font-bold">{item.title}</p> : null}
                            {item.body ? <p className="break-words text-sm text-store-muted-foreground">{item.body}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "customContent") {
              const allBlocks = customContentOf(section).blocks;
              // CUST-HV V9c-2 (V0 §15) — a section with any block kind beyond headings and paragraphs takes the general path (the same
              // decision the storefront makes); a text-only section keeps its original preview, accordion mirror included.
              if (!allBlocks.every((block) => block.kind === "heading" || block.kind === "paragraph")) {
                return (
                  <CanvasContentBlocks
                    key={section.id}
                    blocks={allBlocks}
                    dir={designContext.dir}
                    viewport={viewport}
                    activeBlockId={activeSlides?.[section.id] ?? null}
                    labels={{
                      note: t("cbToneInfo"),
                      success: t("cbToneSuccess"),
                      warning: t("cbToneWarning"),
                      empty: t("cbCanvasEmpty"),
                      item: t("canvasGalleryItem"),
                    }}
                  />
                );
              }
              const blocks = allBlocks.filter(
                (block): block is HeadingBlock | ParagraphBlock => (block.kind === "heading" || block.kind === "paragraph") && block.text.trim() !== "",
              );
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
                    blocks.map((block) => (
                      // CUST-HV V9c-2 — the editor's selected block is ringed and kept in view here too (same wrapper as the general path)
                      <Selectable key={block.id} id={block.id} selected={block.id === (activeSlides?.[section.id] ?? null)}>
                        {block.kind === "heading" ? (
                          block.level === 3 ? (
                            <h3 className={cn("break-words font-extrabold", viewport === "mobile" ? "text-base" : "text-lg", block.align === "center" && "text-center", block.align === "end" && "text-end")}>
                              {block.text}
                            </h3>
                          ) : (
                            <h2 className={cn("break-words text-lg font-extrabold", block.align === "center" && "text-center", block.align === "end" && "text-end")}>
                              {block.text}
                            </h2>
                          )
                        ) : (
                          <p className={cn("whitespace-pre-line break-words text-sm text-store-muted-foreground", block.align === "center" && "text-center", block.align === "end" && "text-end")}>
                            {block.text}
                          </p>
                        )}
                      </Selectable>
                    ))
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
              const featuredOwn = featuredContentOf(section);
              return (
                <section key={section.id} aria-labelledby={headingId}>
                  <h2
                    id={headingId}
                    className={cn("text-base font-extrabold", featuredOwn.showTitle === false && "sr-only")}
                  >
                    {featuredOwn.title ?? t("sectionFeatured")}
                  </h2>
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
                          <div data-card-body="" className={cardPad}>
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
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)} {...shelfAttrs(section.design, viewport)}>
                      {ids
                        .map((id) => products.find((product) => product.id === id))
                        .filter((product): product is NonNullable<typeof product> => product !== undefined)
                        .map((product) => (
                          <li
                            key={product.id}
                            data-card=""
                          className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                          >
                            <div data-card-image="" className={cn(cardImageHeight, "bg-store-surface-muted")}>
                              {product.thumbnailUrl ? (
                                <PreviewMediaImage
                                  src={product.thumbnailUrl}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div data-card-body="" className={cardPad}>
                              <p className="line-clamp-2 text-sm font-semibold text-store-foreground">
                                <bdi>{product.name}</bdi>
                              </p>
                            <PreviewProductMeta product={product} locale={locale} />
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
              const offersOwn = offersContentOf(section);
              return (
                <section key={section.id} aria-labelledby={headingId}>
                  <h2
                    id={headingId}
                    className={cn("text-base font-extrabold", offersOwn.showTitle === false && "sr-only")}
                  >
                    {offersOwn.title ?? t("sectionOffers")}
                  </h2>
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
                          <div data-card-body="" className={cardPad}>
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
                    <ul className={cn("mt-4 grid gap-3", newArrivalsColumns)} {...shelfAttrs(section.design, viewport)}>
                      {liveOffers.map((offer) => (
                        <li
                          key={offer.id}
                          data-home-offer-card=""
                          // `relative` contains the card's sr-only price labels: an absolutely
                          // positioned sr-only span otherwise escapes the clipped preview
                          // scroller and widens the document (horizontal page scroll).
                          data-card=""
                          className="relative min-w-0 overflow-hidden rounded-store border border-store-border bg-store-surface"
                        >
                          <div data-card-image="" className={cn(cardImageHeight, "relative bg-store-surface-muted")}>
                            {offer.product.thumbnailUrl ? (
                              <PreviewMediaImage
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
                          <div data-card-body="" className={cardPad}>
                            <p className="line-clamp-2 break-words text-sm font-semibold text-store-foreground">
                              <bdi>{offerDisplayName(offer, locale)}</bdi>
                            </p>
                            <p data-card-price="" className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
              // FLOWERS-H9c / ADR-21 — the editor receives the same bounded,
              // tenant/storefront/channel-scoped projections as the published
              // sections. It never computes commercial fields and keeps
              // controls decorative/inactive inside the preview frame.
              const incomplete =
                section.type !== "deliveryPromise" && section.content === undefined;
              const state = section.type === "productShelf"
                ? (homeSectionProductsState[section.id] ?? "idle")
                : section.type === "discovery"
                  ? (homeSectionDiscoveryState[section.id] ?? "idle")
                  : (homeSectionDeliveryState[section.id] ?? "idle");
              const title = section.type === "productShelf"
                ? productShelfContentOf(section).title.trim()
                : section.type === "discovery"
                  ? discoveryContentOf(section).title.trim()
                  : deliveryPromiseContentOf(section).title.trim();
              if (section.type === "productShelf") {
                const shelf = productShelfContentOf(section);
                const products = homeSectionProducts[section.id] ?? [];
                const shelfRail = (section.design?.layout ?? (isMarket ? "rail" : "grid")) === "rail";
                const shelfListClass = shelfRail
                  ? "mt-4 flex gap-3 overflow-x-auto pb-2 [&>li]:min-w-[10rem] [&>li]:max-w-[14rem]"
                  : cn("mt-4 grid gap-3", newArrivalsColumns);
                const shelfTitle = title || (shelf.deliverToday && !shelf.source ? t("canvasShelfDeliverToday") : t("canvasShelfShopSelection"));
                return (
                  <section key={section.id} data-home-data-section="productShelf" data-incomplete={incomplete ? "" : undefined}>
                    <div className="flex items-center justify-between gap-3"><SectionRule title={shelfTitle} hideTitle={shelf.showTitle === false} action={t("viewAll")} />{shelf.deliverToday ? <span className="text-[11px] font-medium text-store-muted-foreground">{t("canvasShelfDeliverToday")}</span> : null}</div>
                    {incomplete ? <p className="mt-2 text-xs text-store-muted-foreground">{t("canvasDataSectionIncomplete")}</p> : state === "loading" || state === "idle" ? (
                      <ul aria-hidden="true" className={shelfListClass}>{Array.from({ length: Math.min(shelf.limit, 4) }).map((_, index) => <li key={index} className="overflow-hidden rounded-store border border-store-border bg-store-surface"><div className={cn(cardImageHeight, "animate-pulse bg-store-surface-muted")} /><div className={cardPad}><div className="h-3 w-3/4 animate-pulse rounded-store bg-store-surface-muted" /></div></li>)}</ul>
                    ) : state === "error" ? (
                      <div data-home-section-error="productShelf" className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"><p className="text-sm text-store-muted-foreground">{t("homeNewArrivalsLoadFailed")}</p><button type="button" onClick={() => onRetryHomeDataSection?.(section.id)} className="rounded-store border border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground">{t("retry")}</button></div>
                    ) : products.length === 0 ? (
                      <p data-home-section-empty="productShelf" className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground">{t("homeNewArrivalsEmpty")}</p>
                    ) : (
                      <ul className={shelfListClass} data-shelf-layout={shelfRail ? "rail" : "grid"} {...shelfAttrs(section.design, viewport)}>{products.map((product) => <li key={product.id} data-card="" className="overflow-hidden rounded-store border border-store-border bg-store-surface"><div data-card-image="" className={cn(cardImageHeight, "relative bg-store-surface-muted")}>{product.thumbnailUrl ? <PreviewMediaImage src={product.thumbnailUrl} alt="" className="size-full object-cover" /> : null}</div><div data-card-body="" className={cardPad}><p className="line-clamp-2 text-sm font-semibold text-store-foreground"><bdi>{locale === "en" && product.nameEn ? product.nameEn : product.name}</bdi></p><PreviewProductMeta product={product} locale={locale} /></div></li>)}</ul>
                    )}
                  </section>
                );
              }
              if (section.type === "discovery") {
                const content = discoveryContentOf(section);
                const discovery = homeSectionDiscovery[section.id];
                const headingId = `preview-discovery-${section.id}`;
                const display = resolveDiscoveryDisplay(content);
                const orderedOptions = [...(discovery?.options ?? [])].sort((a, b) => display.valueSort === "count" ? b.count - a.count : 0);
                const options = orderedOptions.slice(0, display.maxItems);
                const columns = viewport === "mobile" ? display.columns.mobile : viewport === "tablet" ? display.columns.tablet : display.columns.desktop;
                const layout = display.layout;
                const discoveryTitle = title || (discovery?.axis === "brand" ? t("canvasDiscoveryShopByBrand") : discovery?.name ? `${t("canvasDiscoveryDiscoverBy")} ${locale === "en" && discovery.nameEn ? discovery.nameEn : discovery.name}`.trim() : t("sectionDiscovery"));
                return (
                  <section key={section.id} aria-labelledby={headingId} data-home-data-section="discovery" data-incomplete={incomplete ? "" : undefined}>
                    <SectionRule title={discoveryTitle} />
                    {incomplete ? <p className="mt-2 text-xs text-store-muted-foreground">{t("canvasDataSectionIncomplete")}</p> : state === "loading" || state === "idle" ? <div aria-hidden="true" className="mt-4 h-20 animate-pulse rounded-store bg-store-surface-muted" /> : state === "error" ? <div data-home-section-error="discovery" className="mt-4 flex flex-col items-center gap-2 rounded-store border border-dashed border-store-border px-4 py-8 text-center"><p className="text-sm text-store-muted-foreground">{t("homeNewArrivalsLoadFailed")}</p><button type="button" onClick={() => onRetryHomeDataSection?.(section.id)} className="rounded-store border border-dashed border-store-border px-3 py-1.5 text-xs font-medium text-store-foreground">{t("retry")}</button></div> : options.length === 0 ? <p data-home-section-empty="discovery" className="mt-4 rounded-store border border-dashed border-store-border px-4 py-8 text-center text-sm text-store-muted-foreground">{t("homeNewArrivalsEmpty")}</p> : content.display === "chips" && layout === null ? <ul data-discovery-layout="chips" data-discovery-show-counts={display.showCounts ? "true" : "false"} className="mt-4 flex flex-wrap gap-2">{options.map((option) => <li key={option.value}><span className="inline-flex min-h-10 items-center rounded-full border border-store-border bg-store-surface px-4 text-sm font-bold text-store-foreground"><bdi>{locale === "en" && option.nameEn ? option.nameEn : option.name}</bdi>{display.showCounts ? <span className="ms-1 text-xs text-store-muted-foreground">({option.count})</span> : null}</span></li>)}</ul> : <ul data-discovery-layout={layout ?? "tiles"} data-discovery-value-sort={display.valueSort} data-discovery-show-counts={display.showCounts ? "true" : "false"} className={cn("mt-4 grid gap-3 md:gap-4", layout === "text-list" ? "grid-cols-1" : layout === "carousel" ? "grid-flow-col auto-cols-[minmax(9rem,1fr)] overflow-x-auto" : discoveryGridColumnsClass(columns))}>{options.map((option) => { const visual = discovery && layout && layout !== "text-list" ? resolvedDiscoveryVisual(discovery, option, display, layout) : null; const image = visual?.content === "image" ? discoveryOptionSources(option.visual) : null; const label = locale === "en" && option.nameEn ? option.nameEn : option.name; return <li key={option.value} className="min-w-0"><span className={cn("flex min-h-20 flex-col items-center justify-center rounded-store border border-store-border bg-store-surface px-3 py-4 text-center text-sm font-bold text-store-foreground", layout === "text-list" && "items-start text-start", layout === "image-cards" && "overflow-hidden p-0")}>{visual ? <FacetVisualTile visual={visual} label={label} image={image} className="w-full" /> : <bdi>{label}</bdi>}{display.showCounts && (!visual || visual.showLabel) ? <span className="mt-1 text-xs font-normal text-store-muted-foreground">{option.count}</span> : null}</span></li>; })}</ul>}
                  </section>
                );
              }
              const promise = deliveryPromiseContentOf(section);
              const earliest = homeSectionDelivery[section.id];
              const headingId = `preview-delivery-${section.id}`;
              const deliveryDay = earliest ? formatDeliveryDay({ date: earliest.date, timezone: earliest.timezone, locale, todayLabel: t("canvasDeliveryToday"), tomorrowLabel: t("canvasDeliveryTomorrow") }) : null;
              const deliveryWindow = earliest ? formatDeliveryWindow(earliest.startTime, earliest.endTime, locale) : null;
              const deliveryLabel = deliveryDay && deliveryWindow ? `${deliveryDay}${locale === "ar" ? "، " : ", "}${deliveryWindow}` : null;
              return (
                <section key={section.id} aria-labelledby={headingId} data-home-data-section="deliveryPromise" className="rounded-store border border-store-border bg-store-surface px-4 py-4 md:px-6 md:py-5">
                  <h2 id={headingId} className="text-base font-extrabold text-store-foreground md:text-lg">{title || t("canvasDeliveryEarliest")}</h2>
                  {state === "loading" || state === "idle" ? <div aria-hidden="true" className="mt-2 h-5 w-2/3 animate-pulse rounded-store bg-store-surface-muted" /> : state === "error" ? <div data-home-section-error="deliveryPromise" className="mt-3 flex items-center gap-2 text-xs text-store-muted-foreground"><span>{t("homeNewArrivalsLoadFailed")}</span><button type="button" onClick={() => onRetryHomeDataSection?.(section.id)} className="underline">{t("retry")}</button></div> : earliest && deliveryLabel ? <><p className="mt-1 text-sm font-bold text-store-primary md:text-base"><bdi>{deliveryLabel}</bdi></p>{promise.body ? <p className="mt-1 text-xs text-store-muted-foreground md:text-sm">{promise.body}</p> : null}</> : <p data-home-section-empty="deliveryPromise" className="mt-2 text-sm text-store-muted-foreground">{t("canvasDeliveryPromiseLive")}</p>}
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
                label={section.label}
                actions={
                  sectionActions ? (
                    <SectionActionBar
                      section={section}
                      actions={sectionActions}
                      eligibility={sectionEligibility(config.homepage.sections, section)}
                    />
                  ) : undefined
                }
              >
                <SectionDesignFrame
                  section={section}
                  context={designContext}
                  extraAttrs={overlayHero?.sectionId === section.id ? { "data-ho": overlayMarker(overlayHero) } : undefined}
                >
                  {content}
                </SectionDesignFrame>
              </SelectablePreviewSection>
            );
          })}
        {firstHeroId === undefined ? (
          // CUST-HV V6a (V0 §8.1.3) — the page always has one <h1>: with no visible hero the store
          // is named in a visually-hidden one, exactly as the published storefront does (last in the
          // stack, so the stack's vertical rhythm is unaffected).
          <h1 className="sr-only" data-preview-store-heading="">
            <bdi>{storeName}</bdi>
          </h1>
        ) : null}
      </div>
      )}

      <CanvasFooter
        config={config}
        t={t}
        locale={locale}
        viewport={viewport}
        storeName={storeName}
        logo={logo}
        onSelectChrome={onSelectChrome as never}
        selectedChrome={selectedChrome}
        pageTitles={visiblePages.map((page) => page.title.trim() || t(pageTitleKey(page.slug)))}
        contact={{ phone: phone ?? "", email: email ?? "", address: address ?? "", hours: hours ?? "" }}
        footerWhatsapp={footerWhatsapp}
        social={enabledSocial.map((item) => ({ id: item.id, network: item.network, href: item.href, label: socialLabel(t, item.network) }))}
        identity={{ legalName, crNumber, vatNumber, has: hasBusinessIdentity }}
        apps={{ ios, android, has: hasApps }}
        categories={homeCategories}
        colourContext={{ primaryColor: config.primaryColor, accentColor: config.accentColor, palette: config.palette }}
      />

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

function PreviewProductMeta({
  product,
  locale,
}: {
  product: { priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean };
  locale: CustomizerLocale;
}) {
  return (
    <div className="mt-2 space-y-1">
      {product.isVariantManaged ? (
        <p className="text-xs font-medium text-store-muted-foreground">{locale === "ar" ? "السعر حسب الخيار" : "Priced by option"}</p>
      ) : typeof product.priceAmountMinor === "number" && product.priceAmountMinor >= 0 ? (
        <p className="text-sm font-bold text-store-primary">
          <bdi>{formatMinorAmount(product.priceAmountMinor, product.currency ?? "SAR", locale)}</bdi>
        </p>
      ) : null}
      {product.inStock === true && (
        <p className="text-[11px] font-medium text-store-success">
          {locale === "ar" ? "متوفر" : "In stock"}
        </p>
      )}
      {product.inStock === false ? (
        <span className="block w-full rounded-store border border-store-border px-2 py-1 text-center text-xs font-semibold text-store-muted-foreground">
          {locale === "ar" ? "غير متوفر" : "Out of stock"}
        </span>
      ) : product.isVariantManaged ? (
        <span className="block w-full rounded-store border border-store-primary px-2 py-1 text-center text-xs font-bold text-store-primary">
          {locale === "ar" ? "اختيار الخيارات" : "Select options"}
        </span>
      ) : (
        <button type="button" disabled aria-disabled="true" className="w-full rounded-store bg-store-primary px-2 py-1 text-xs font-semibold text-store-primary-foreground">
          {locale === "ar" ? "إضافة للسلة" : "Add to cart"}
        </button>
      )}
    </div>
  );
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
                      <PreviewMediaImage src={product.media[0].url} alt={product.media[0].alt ?? ""} className="size-full object-cover" />
                    </div>
                    {product.media.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {product.media.slice(1, 5).map((m) => (
                          <PreviewMediaImage key={m.id} src={m.url} alt={m.alt ?? ""} className="size-14 shrink-0 rounded-store object-cover" />
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
  gridProducts?: { id: string; name: string; thumbnailUrl: string | null; priceAmountMinor?: number | null; currency?: string; inStock?: boolean | null; isVariantManaged?: boolean }[];
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
          case "cover":
            // CUST-HV V9a — the workspace category read does not carry the picture, so the preview cannot show THIS category's
            // image; it says plainly what the published page does (the picture when the category has one, nothing otherwise).
            return wrap(
              region,
              <div
                data-category-preview-cover=""
                className="flex aspect-[16/5] items-center justify-center rounded-store border border-dashed border-store-border-strong bg-store-surface-muted px-4 text-center"
              >
                <p className="text-xs leading-5 text-store-muted-foreground">{t("categoryPreviewCoverNote")}</p>
              </div>,
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
                          <PreviewMediaImage src={product.thumbnailUrl} alt="" className="size-full object-cover" />
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
                      <div className={cn(productCard === "compact" ? "px-1.5 pb-1" : "px-2 pb-1.5")}>
                        <PreviewProductMeta product={product} locale={locale} />
                      </div>
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

/** What the action bar may offer for a section, from the same capability rules the section list uses. */
function sectionEligibility(
  sections: readonly PresentationHomeSection[],
  section: PresentationHomeSection,
): CanvasSectionEligibility {
  const index = sections.findIndex((item) => item.id === section.id);
  return {
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < sections.length - 1,
    canDuplicate: canDuplicateSection(sections, section),
    canDelete: canDeleteSection(section),
    authored: sectionIsAuthored(section),
  };
}

function SelectablePreviewSection({
  sectionKey,
  sectionId,
  selected,
  onSelect,
  label,
  actions,
  children,
}: {
  sectionKey: string;
  sectionId: string;
  selected: boolean;
  onSelect?: (id: string) => void;
  /** CUST-HV V10c (V0 §17.1) — the merchant's own name for the section: an editor aid shown only on the selected section. */
  label?: string;
  /** CUST-HV V10d — the hover action bar, rendered inside the wrapper (the sibling rules of the hero overlap stay valid). */
  actions?: ReactNode;
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
        // only the wrapper's own Enter / Space selects: a keystroke bubbling from a control inside the section (slider arrows and
        // dots, the motion toggle) must reach that control, not be cancelled here
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(sectionId);
        }
      }}
      className={cn(
        "awj-preview-section",
        selected && "awj-preview-section-selected",
        selected && label && "awj-preview-section-named",
        actions && "awj-preview-section-actionable",
      )}
    >
      {selected && label ? (
        // Editor chrome, never storefront content: plain text (the label is merchant-typed), not announced twice (the list and the
        // inspector carry it), and transparent to the pointer so it never intercepts a click on the section.
        <span aria-hidden="true" data-section-chip="" className="awj-preview-section-chip">
          {label}
        </span>
      ) : null}
      {children}
      {actions}
    </div>
  );
}

function SectionRule({
  title,
  action,
  hideTitle = false,
}: {
  title: string;
  action?: string;
  /** CUST-HV V9d-3 — the merchant chose not to show the shelf title: it stays as the accessible name, only the action remains visible. */
  hideTitle?: boolean;
}) {
  if (hideTitle) {
    return (
      <div data-section-heading="" data-title-hidden="" className="flex items-start justify-end gap-4">
        <h2 className="sr-only">
          {title}
        </h2>
        {action ? <span data-section-action="" className="text-xs font-bold text-store-primary md:text-sm">{action}</span> : null}
      </div>
    );
  }
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
      {action ? <span data-section-action="" className="text-xs font-bold text-store-primary md:text-sm">{action}</span> : null}
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
