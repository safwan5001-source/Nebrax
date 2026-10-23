"use client";

import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { DEFAULT_TENANT_TIMEZONE } from "@/lib/timezone";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  canAddSectionType,
  canDuplicateSection,
  canDeleteSection,
  type CONTENT_PAGE_SLUGS,
  contrastRatio,
  DENSITY_PRESETS,
  FONT_PRESETS,
  type FontPresetId,
  hasAddableSectionType,
  ALL_HOME_SECTION_KEYS,
  type HomeBuilderSectionKey,
  isGatedHomeSection,
  MAX_HOME_SECTIONS,
  MAX_SECTION_LABEL,
  moveSectionTo,
  setSectionVisible,
  duplicateSection as duplicateSectionOp,
  deleteSection as deleteSectionOp,
  sectionIsAuthored,
  legacyHeroContent,
  isHeroAuthored,
  newHomeSectionId,
  type PresentationHomeSection,
  presetSelectionPatch,
  PRODUCT_CARD_PRESETS,
  RADIUS_PRESETS,
  SECTION_CAPABILITIES,
  SOCIAL_NETWORKS,
  type SocialNetwork,
  type StorefrontPresentationConfig,
  THEME_PRESETS,
  type ThemePresetId,
} from "./presentation";
import { HeaderDesignPanel } from "./HeaderDesignPanel";
import { FooterEditor } from "./FooterEditor";
import { GlobalBackgroundField } from "./GlobalBackgroundField";
import { NavigationPanel } from "./NavigationPanel";
import { emptyMainMenu, migrateLegacyLinks, withMainMenu } from "./navigation-edit";
import { presentationCssVars } from "./presentation/tokens";
import { mainMenu } from "./presentation/navigation";
import { SectionLibraryContent, SectionLibraryDialog } from "./SectionLibrary";
import { buildWhatsAppUrl, sanitizeExternalUrl } from "./presentation/urls";
import {
  bannerContentOf,
  bannerCtasOf,
  type HeroContent,
  galleryContentOf,
  heroContentOf,
  isTextlessSection,
  sliderContentOf,
  benefitsContentOf,
  customContentOf,
  deliveryPromiseContentOf,
  discoveryContentOf,
  emptyBannerContent,
  featuredContentOf,
  offersContentOf,
  newArrivalsContentOf,
  productShelfContentOf,
  CTA_COLOURS,
  CTA_STYLES,
  MAX_BENEFIT_ITEMS,
  MAX_FEATURED_PRODUCTS,
  MAX_OFFERS,
  type BannerContent,
  type BenefitItem,
  type CtaColour,
  type CtaStyle,
} from "./presentation/section-content";
import { type CtaColourIssue, ctaColourIssues } from "./presentation/cta-colour";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";
import { LogoMediaSlot } from "./media/LogoMediaSlot";
import { announcementWindowState } from "./presentation/announcements";
import { WindowFields } from "./WindowFields";
import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";
import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import {
  DeliveryPromiseFields,
  DiscoveryFields,
  ProductShelfFields,
} from "./DataSectionFields";
import { OfferCatalog } from "./OfferCatalog";
import { CategoriesDisplayFields } from "./CategoriesDisplayFields";
import { DesignInspector } from "./design/DesignInspector";
import { ContentBlocksFields } from "./ContentBlocksFields";
import { BufferedText, stored } from "./BufferedText";
import { ShelfTitleFields } from "./ShelfTitleFields";
import { GalleryFields } from "./GalleryFields";
import { SliderFields } from "./SliderFields";
import { useBackgroundMediaBounds } from "./media/use-background-media-bounds";
import { GlobalTokensEditor } from "./design/GlobalTokensEditor";
import { PaletteEditor } from "./design/PaletteEditor";
import { ICON_KEYS, iconLabel, normalizeIconKey } from "./presentation/icon-registry";
import { SECTION_DESIGN_CAPABILITIES } from "./presentation/section-design";
import type { SectionDesign } from "./presentation/section-design";
import type { DesignContext } from "./presentation/section-design-resolve";
import { OfferSummary, OfferThumb } from "./OfferParts";
import { offerDisplayName } from "./offers-display";
import type { OfferManagement } from "./offers-management";
import { DesignLibraryPanel } from "./DesignLibraryPanel";

export type CustomizerPanel =
  | "theme"
  | "designLibrary"
  | "branding"
  | "header"
  | "homepage"
  | "product"
  | "category"
  | "footer"
  | "contact"
  | "whatsapp"
  | "social"
  | "announcements"
  | "verification"
  | "apps"
  | "pages";

export const CUSTOMIZER_NAV_GROUPS: Array<{
  items: Array<{ id: CustomizerPanel; label: CustomizerMessageKey }>;
}> = [
  {
    items: [
      { id: "theme", label: "theme" },
      { id: "designLibrary", label: "designLibraryNav" },
      { id: "branding", label: "branding" },
    ],
  },
  {
    items: [
      { id: "announcements", label: "announcements" },
      { id: "header", label: "header" },
      { id: "homepage", label: "homepage" },
      { id: "product", label: "productRegionsPanelLabel" },
      { id: "category", label: "categoryRegionsPanelLabel" },
      { id: "footer", label: "footer" },
    ],
  },
  {
    items: [
      { id: "contact", label: "contact" },
      { id: "whatsapp", label: "whatsapp" },
      { id: "social", label: "social" },
    ],
  },
  {
    items: [
      { id: "verification", label: "verification" },
      { id: "apps", label: "apps" },
      { id: "pages", label: "pages" },
    ],
  },
];

export const CUSTOMIZER_PANELS = CUSTOMIZER_NAV_GROUPS.flatMap(
  (group) => group.items,
);

const PAGE_LABEL: Record<
  (typeof CONTENT_PAGE_SLUGS)[number],
  CustomizerMessageKey
> = {
  about: "pageAbout",
  contact: "pageContact",
  faq: "pageFaq",
  "shipping-policy": "pageShipping",
  "privacy-policy": "pagePrivacy",
  "returns-policy": "pageReturns",
  "terms-of-service": "pageTerms",
};

// CUST-H4-2 — titles now live once in SECTION_CAPABILITIES (the Section
// Library's own source of truth); this stays a thin derived alias so every
// other `SECTION_LABEL[type]` call site in this file is untouched.
const SECTION_LABEL: Record<HomeBuilderSectionKey, CustomizerMessageKey> =
  Object.fromEntries(
    ALL_HOME_SECTION_KEYS.map((type) => [
      type,
      SECTION_CAPABILITIES[type].titleKey,
    ]),
  ) as Record<HomeBuilderSectionKey, CustomizerMessageKey>;

interface PanelsProps {
  panel: CustomizerPanel;
  config: StorefrontPresentationConfig;
  locale: CustomizerLocale;
  liveStoreName: string | null;
  businessIdentity?: {
    legal_name: string | null;
    cr_number: string | null;
    vat_number: string | null;
  };
  onChange: (next: StorefrontPresentationConfig) => void;
  selectedSection?: string | null;
  onSelectSection?: (id: string | null) => void;
  /** CUST-HV V8c — the slide each slider section is showing (shared with the Canvas), by section id. */
  activeSlides?: Record<string, string>;
  onActiveSlideChange?: (sectionId: string, slideId: string) => void;
  /** CUST-H4-2 mobile fix — only `HomepagePanel` reads this, to pick the
   * Section Library's presentation: a centered dialog on desktop, inline
   * content replacing the composer body on mobile (no nested Bottom Sheet). */
  isMobileViewport?: boolean;
  /**
   * CUST-H4-5 — the real multi-select "Featured" product picker's own
   * search/list (independent of which section is selected) and the
   * per-section-instance batched resolution of already-selected products
   * (keyed by section id — "featured" is not a singleton section type).
   * All owned/fetched by `ExperienceBuilder`; this component stays purely
   * presentational, same as every other home-section data seam.
   */
  featuredPickerSearch?: string;
  featuredPickerListState?: "idle" | "loading" | "error" | "ready";
  featuredPickerList?: WorkspaceProductSummary[];
  onFeaturedPickerSearchChange?: (value: string) => void;
  onRetryFeaturedPickerList?: () => void;
  featuredResolved?: Record<string, WorkspaceProductSummary[]>;
  featuredResolvedState?: Record<string, "idle" | "loading" | "error" | "ready">;
  onRetryFeaturedResolution?: (sectionId: string) => void;
  /**
   * CUST-H4-7 — the one shared workspace Offers read (all candidates with
   * their live/hidden evaluation). Every "offers" section instance selects
   * from this same list by its own `offerIds`; owned/fetched by
   * `ExperienceBuilder`, so this component stays purely presentational.
   */
  offers?: WorkspaceOffer[];
  offersState?: "idle" | "loading" | "error" | "ready";
  onRetryOffers?: () => void;
  /** CUST-H4-7b — merchant CRUD actions over the configured Offers catalog. */
  offerManagement?: OfferManagement;
  /** CUST-HV V3 — the store's authoritative IANA zone (`/me` → `company.timezone`); announcement windows are entered in it. */
  timezone?: string;
  /** CUST-HV V7d-4 — the workspace storefront the navigation pickers read categories / products from. */
  storefrontId?: string | null;
}

export function ControlPanels({
  panel,
  config,
  locale,
  liveStoreName,
  businessIdentity,
  onChange,
  selectedSection = null,
  onSelectSection,
  activeSlides,
  onActiveSlideChange,
  isMobileViewport = false,
  featuredPickerSearch = "",
  featuredPickerListState = "idle",
  featuredPickerList = [],
  onFeaturedPickerSearchChange,
  onRetryFeaturedPickerList,
  featuredResolved = {},
  featuredResolvedState = {},
  onRetryFeaturedResolution,
  offers = [],
  offersState = "idle",
  onRetryOffers,
  offerManagement,
  timezone = DEFAULT_TENANT_TIMEZONE,
  storefrontId = null,
}: PanelsProps) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const patch = (partial: Partial<StorefrontPresentationConfig>) =>
    onChange({ ...config, ...partial });

  switch (panel) {
    case "theme":
      return <ThemePanel config={config} t={t} patch={patch} replace={onChange} locale={locale} />;
    case "designLibrary":
      return (
        <DesignLibraryPanel
          config={config}
          locale={locale}
          selectedSection={selectedSection}
          onChange={onChange}
          onSelectSection={onSelectSection}
        />
      );
    case "branding":
      return (
        <BrandingPanel
          config={config}
          t={t}
          liveStoreName={liveStoreName}
          patch={patch}
          locale={locale === "en" ? "en" : "ar"}
        />
      );
    case "header":
      return <HeaderPanel config={config} t={t} patch={patch} locale={locale} storefrontId={storefrontId} />;
    case "homepage":
      return (
        <HomepagePanel
          config={config}
          t={t}
          patch={patch}
          selectedSection={selectedSection}
          onSelectSection={onSelectSection}
          activeSlides={activeSlides}
          onActiveSlideChange={onActiveSlideChange}
          isMobileViewport={isMobileViewport}
          featuredPickerSearch={featuredPickerSearch}
          featuredPickerListState={featuredPickerListState}
          featuredPickerList={featuredPickerList}
          onFeaturedPickerSearchChange={onFeaturedPickerSearchChange}
          onRetryFeaturedPickerList={onRetryFeaturedPickerList}
          featuredResolved={featuredResolved}
          featuredResolvedState={featuredResolvedState}
          onRetryFeaturedResolution={onRetryFeaturedResolution}
          locale={locale}
          timezone={timezone}
          offers={offers}
          offersState={offersState}
          onRetryOffers={onRetryOffers}
          offerManagement={offerManagement}
        />
      );
    case "footer":
      return <FooterPanel config={config} t={t} patch={patch} locale={locale === "en" ? "en" : "ar"} storefrontId={storefrontId} />;
    case "contact":
      return <ContactPanel config={config} t={t} patch={patch} />;
    case "whatsapp":
      return <WhatsAppPanel config={config} t={t} patch={patch} />;
    case "social":
      return <SocialPanel config={config} t={t} patch={patch} />;
    case "announcements":
      return (
        <AnnouncementsPanel
          doc={config.announcements}
          locale={locale}
          timezone={timezone}
          defaultBackground={config.primaryColor}
          onChange={(announcements) => patch({ announcements })}
        />
      );
    case "verification":
      return (
        <VerificationPanel
          config={config}
          t={t}
          patch={patch}
          businessIdentity={businessIdentity}
        />
      );
    case "apps":
      return <AppsPanel config={config} t={t} patch={patch} />;
    case "pages":
      return <PagesPanel config={config} t={t} patch={patch} />;
    default:
      return null;
  }
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] font-medium text-neutral-600">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[12px] leading-5 text-neutral-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title || hint ? (
        <div className="space-y-1">
          {title ? (
            <h3 className="text-[12px] font-semibold tracking-wide text-neutral-500">
              {title}
            </h3>
          ) : null}
          {hint ? (
            <p className="text-[12px] leading-5 text-neutral-500">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex border border-neutral-300 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-9 flex-1 px-2 text-[12px] font-medium ${
            value === option.id
              ? "bg-primary text-primary-foreground"
              : "text-neutral-600 hover:bg-primary-soft hover:text-primary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** CUST-HV V9d-3 — a featured / offers shelf's content: its picked ids plus its optional title; nothing while both are empty. */
function shelfContent<K extends "productIds" | "offerIds">(
  ids: Record<K, string[]>,
  own: { title?: string; showTitle?: false },
): (Record<K, string[]> & { title?: string; showTitle?: false }) | undefined {
  const ownFields: { title?: string; showTitle?: false } = {};
  if (own.title !== undefined) ownFields.title = own.title;
  if (own.showTitle === false) ownFields.showTitle = false;
  const hasIds = Object.values<string[]>(ids).some((list) => list.length > 0);
  if (!hasIds && Object.keys(ownFields).length === 0) return undefined;
  return { ...ids, ...ownFields };
}

export const inputClass =
  "h-10 w-full border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";
export const selectClass = inputClass;
export const btnClass =
  "inline-flex h-8 items-center border border-neutral-300 bg-white px-2.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50";
export const iconBtnClass =
  "inline-flex size-7 items-center justify-center text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:bg-transparent";

function moveIndex<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function ThemePanel({
  config,
  t,
  patch,
  replace,
  locale = "ar",
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  /** Whole-config write: the global background must be able to *remove* its `background` object. */
  replace: (next: StorefrontPresentationConfig) => void;
  locale?: CustomizerLocale;
}) {
  const contrast = contrastRatio(config.primaryColor, "#ffffff");
  // Typing a hex that happens to equal a bundled preset's exact swatch (e.g.
  // Market's #0f766e) is the same *transition* as clicking that preset's
  // button — it must carry the same starting bundle, or the merchant ends up
  // on "Market" with none of its compact density/card/header, and clicking
  // the now-already-selected swatch can never repair it (presetSelectionPatch
  // treats an active preset as a no-op re-click by design).
  const applyColor = (hex: string) =>
    patch(presetSelectionPatch(config, { id: matchPreset(hex, config.themePreset), primary: hex }));
  return (
    <div className="space-y-7">
      <Section title={t("preset")}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
          {THEME_PRESETS.map((preset) => {
            const selected = config.themePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patch(presetSelectionPatch(config, preset))}
                className={`overflow-hidden border text-start ${
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-neutral-200 hover:border-primary/50"
                }`}
              >
                <span
                  className="block p-1.5"
                  style={{ background: preset.primary }}
                >
                  <span className="flex h-10 flex-col bg-white">
                    <span
                      className="block h-2.5"
                      style={{ background: preset.primary, opacity: 0.18 }}
                    />
                    <span className="mt-auto flex gap-1 p-1">
                      <span
                        className="h-3.5 flex-1"
                        style={{ background: preset.primary, opacity: 0.22 }}
                      />
                      <span
                        className="h-3.5 flex-1"
                        style={{ background: preset.primary, opacity: 0.12 }}
                      />
                    </span>
                  </span>
                </span>
                <span className="block truncate px-2 py-1.5 text-[12px] font-medium leading-tight text-neutral-800">
                  {t(preset.labelKey as CustomizerMessageKey)}
                </span>
              </button>
            );
          })}
        </div>
      </Section>
      <Field
        label={t("primaryColor")}
        hint={contrast >= 4.5 ? t("contrastOk") : t("contrastWarn")}
      >
        <div className="flex items-stretch gap-2">
          <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden border border-neutral-300">
            <span
              className="absolute inset-0"
              style={{ background: config.primaryColor }}
            />
            <input
              type="color"
              aria-label={t("primaryColor")}
              value={config.primaryColor}
              onChange={(event) => applyColor(event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            aria-label={t("primaryColor")}
            className={`${inputClass} font-mono uppercase tracking-wide`}
            value={config.primaryColor}
            onChange={(event) => applyColor(event.target.value)}
          />
        </div>
      </Field>
      <GlobalBackgroundField config={config} onReplace={replace} t={t} locale={locale === "en" ? "en" : "ar"} />
      <div className="space-y-5">
        <Field label={t("font")}>
          <select
            className={selectClass}
            value={config.fontPreset}
            onChange={(event) =>
              patch({ fontPreset: event.target.value as FontPresetId })
            }
          >
            {FONT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.labelKey
                  ? t(preset.labelKey as CustomizerMessageKey)
                  : preset.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("density")}>
          <Segmented
            value={config.density}
            onChange={(density) => patch({ density })}
            options={DENSITY_PRESETS.map((id) => ({
              id,
              label:
                id === "comfortable"
                  ? t("densityComfortable")
                  : t("densityCompact"),
            }))}
          />
        </Field>
        <Field label={t("radius")}>
          <Segmented
            value={config.radius}
            onChange={(radius) => patch({ radius })}
            options={RADIUS_PRESETS.map((preset) => ({
              id: preset.id,
              label:
                preset.id === "default"
                  ? t("radiusDefault")
                  : preset.id === "subtle"
                    ? t("radiusSubtle")
                    : t("radiusSharp"),
            }))}
          />
        </Field>
        <Field label={t("productCard")}>
          <Segmented
            value={config.productCard}
            onChange={(productCard) => patch({ productCard })}
            options={PRODUCT_CARD_PRESETS.map((id) => ({
              id,
              label:
                id === "standard"
                  ? t("productCardStandard")
                  : t("productCardCompact"),
            }))}
          />
        </Field>
        <Section title={t("paletteTitle")} hint={t("paletteHint")}>
          <PaletteEditor
            palette={config.palette}
            ctx={{
              primaryColor: config.primaryColor,
              accentColor: config.accentColor,
              palette: config.palette,
              dir: locale === "en" ? "ltr" : "rtl",
            }}
            t={t}
            onChange={(palette) => patch({ palette })}
            onAccentChange={(accentColor) => patch({ accentColor })}
          />
        </Section>
        <Section title={t("gtTitle")} hint={t("gtHint")}>
          <GlobalTokensEditor
            config={config}
            t={t}
            patch={patch}
            colours={{
              primaryColor: config.primaryColor,
              accentColor: config.accentColor,
              palette: config.palette,
            }}
          />
        </Section>
      </div>
    </div>
  );
}

/**
 * A custom color that doesn't match any preset's swatch keeps the merchant's
 * *current* preset rather than silently renaming it to `awj-modern` — a
 * bundled preset (currently only AWJ Market) carries real behavior keyed off
 * `themePreset` (see `usePublishedThemeMarker`), so resetting it on an
 * ordinary color tweak would silently drop that styling too.
 */
export function matchPreset(hex: string, current: ThemePresetId): ThemePresetId {
  return (
    THEME_PRESETS.find((preset) => preset.primary === hex.toLowerCase())?.id ??
    current
  );
}

const BRANDING_LOGO_SLOTS = [
  { slot: "logo", label: "logo", hint: "logoHint", legacyKey: "logoDataUrl", mediaKey: "logoMedia" },
  { slot: "compactLogo", label: "compactLogo", hint: null, legacyKey: "compactLogoDataUrl", mediaKey: "compactLogoMedia" },
  { slot: "favicon", label: "favicon", hint: null, legacyKey: "faviconDataUrl", mediaKey: "faviconMedia" },
] as const;

function BrandingPanel({
  config,
  t,
  liveStoreName,
  patch,
  locale,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  liveStoreName: string | null;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  locale: "ar" | "en";
}) {
  // CUST-H3-1 — one Store Identity surface: display name, logo, compact logo
  // and favicon were already a single `branding.*` persistence group (no
  // storage change here), but the UI previously rendered them as a bare
  // field list with no shared framing. The inspector header above already
  // shows the panel's own title ("Identity"/"الهوية" — see `ControlPanels`'
  // switch); this only adds the explanatory intro, not a second heading
  // that would repeat it.
  return (
    <div className="space-y-6">
      <Section hint={t("identityIntro")}>
        <Field label={t("displayName")} hint={t("displayNameHint")}>
          <input
            className={inputClass}
            value={config.branding.displayName}
            placeholder={liveStoreName ?? ""}
            onChange={(event) =>
              patch({
                branding: { ...config.branding, displayName: event.target.value },
              })
            }
          />
        </Field>
        {liveStoreName ? (
          <p className="text-[12px] text-neutral-500">
            {t("liveName")}: {liveStoreName}
          </p>
        ) : null}
        {BRANDING_LOGO_SLOTS.map((slot) => {
          const legacyValue = config.branding[slot.legacyKey];
          const media = config.branding[slot.mediaKey] ?? null;
          return (
            <LogoMediaSlot
              key={slot.slot}
              slot={slot.slot}
              label={t(slot.label)}
              hint={slot.hint ? t(slot.hint) : undefined}
              media={media}
              hasLegacy={Boolean(legacyValue)}
              t={t}
              locale={locale}
              legacyControl={
                <LogoField
                  label={t(slot.label)}
                  hint={slot.hint ? t(slot.hint) : undefined}
                  value={legacyValue}
                  t={t}
                  onChange={(next) =>
                    patch({ branding: { ...config.branding, [slot.legacyKey]: next } })
                  }
                />
              }
              onMediaChange={(next, { clearLegacy }) => {
                const branding = { ...config.branding };
                if (next) branding[slot.mediaKey] = next;
                else delete branding[slot.mediaKey];
                if (clearLegacy) branding[slot.legacyKey] = null;
                patch({ branding });
              }}
            />
          );
        })}
      </Section>
    </div>
  );
}

function LogoField({
  label,
  hint,
  value,
  t,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | null;
  t: (key: CustomizerMessageKey) => string;
  onChange: (value: string | null) => void;
}) {
  // CUST-H3-1 — all three logo slots previously shared the same literal
  // "Choose image"/"Remove" accessible name (the upload `<label>`'s own text
  // is what Testing Library/screen readers compute as the `<input>`'s name
  // when nothing more specific is set), so assistive tech could not tell the
  // logo, compact logo and favicon controls apart. An explicit `aria-label`
  // on the input/button wins over that implicit label text and names each
  // field distinctly, without changing the visible copy or upload semantics.
  const uploadAccessibleLabel = `${label} — ${t("uploadLogo")}`;
  const removeAccessibleLabel = `${label} — ${t("clearLogo")}`;
  return (
    <div className="space-y-1.5">
      <span className="block text-[12px] font-medium text-neutral-600">
        {label}
      </span>
      <div className="flex items-center gap-2">
        {value ? (
          <img
            src={value}
            alt=""
            className="size-10 shrink-0 rounded-sm border border-neutral-200 bg-white object-contain"
          />
        ) : null}
        <label className={btnClass}>
          {t("uploadLogo")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={uploadAccessibleLabel}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const result =
                  typeof reader.result === "string" ? reader.result : null;
                onChange(result);
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            className={btnClass}
            aria-label={removeAccessibleLabel}
            onClick={() => onChange(null)}
          >
            {t("clearLogo")}
          </button>
        ) : (
          <span className="text-[12px] text-neutral-500">{t("noLogo")}</span>
        )}
      </div>
      {hint ? (
        <p className="text-[12px] leading-5 text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

function HeaderPanel({
  config,
  t,
  patch,
  locale,
  storefrontId = null,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  locale: string;
  storefrontId?: string | null;
}) {
  const [skippedLinks, setSkippedLinks] = useState<string[]>([]);
  const hasMainMenu = Boolean(mainMenu(config.navigation));
  return (
    <div className="space-y-6">
      <Field label={t("headerStyle")}>
        <Segmented
          value={config.header.style}
          onChange={(style) => patch({ header: { ...config.header, style } })}
          options={[
            { id: "standard" as const, label: t("headerStandard") },
            { id: "compact" as const, label: t("headerCompact") },
          ]}
        />
      </Field>
      {config.header.design?.layout ? (
        <p
          role="status"
          data-header-style-overridden=""
          className="text-[12px] leading-5 text-muted"
        >
          {t("headerLayoutOverridesStyle")}
        </p>
      ) : null}
      <HeaderDesignPanel
        design={config.header.design}
        sections={config.homepage.sections}
        ctx={{
          primaryColor: config.primaryColor,
          accentColor: config.accentColor,
          palette: config.palette,
          dir: locale === "en" ? "ltr" : "rtl",
        }}
        t={t}
        onChange={(design) => {
          const { design: _previous, ...rest } = config.header;
          patch({ header: design ? { ...rest, design } : rest });
        }}
      />
      <div className="divide-y divide-neutral-200 border-y border-neutral-200">
        <Toggle
          label={t("showSearch")}
          checked={config.header.showSearch}
          onChange={(showSearch) =>
            patch({ header: { ...config.header, showSearch } })
          }
        />
        <Toggle
          label={t("showAccount")}
          checked={config.header.showAccount}
          onChange={(showAccount) =>
            patch({ header: { ...config.header, showAccount } })
          }
        />
        <Toggle
          label={t("showCart")}
          checked={config.header.showCart}
          onChange={(showCart) =>
            patch({ header: { ...config.header, showCart } })
          }
        />
        <Toggle
          label={t("showCategoryNav")}
          checked={config.header.showCategoryNav}
          onChange={(showCategoryNav) =>
            patch({ header: { ...config.header, showCategoryNav } })
          }
        />
      </div>
      {hasMainMenu ? (
        <>
          {skippedLinks.length > 0 ? (
            <div role="status" data-nav-migration-skipped="" className="border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-text">
              <p>{t("navMigrationSkipped")}</p>
              <p className="font-medium">{skippedLinks.join(" · ")}</p>
            </div>
          ) : null}
          <NavigationPanel
            navigation={config.navigation}
            storefrontId={storefrontId}
            locale={locale === "en" ? "en" : "ar"}
            t={t}
            onChange={(navigation) => patch({ navigation })}
          />
        </>
      ) : (
        <>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-neutral-500">
            {t("navLinks")}
          </span>
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              patch({
                header: {
                  ...config.header,
                  links: [
                    ...config.header.links,
                    {
                      id: `nav-${Date.now()}`,
                      label: "",
                      kind: "home" as const,
                      href: "/",
                      enabled: true,
                    },
                  ].slice(0, 12),
                },
              })
            }
          >
            {t("addLink")}
          </button>
        </div>
        <ul className="border border-neutral-200">
          {config.header.links.map((link, index) => (
            <li
              key={link.id}
              className="space-y-2 border-b border-neutral-200 p-3 last:border-b-0"
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputClass}
                  placeholder={t("linkLabel")}
                  value={link.label}
                  onChange={(event) => {
                    const links = config.header.links.map((item, i) =>
                      i === index
                        ? { ...item, label: event.target.value }
                        : item,
                    );
                    patch({ header: { ...config.header, links } });
                  }}
                />
                <select
                  className={selectClass}
                  value={link.kind}
                  onChange={(event) => {
                    const links = config.header.links.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            kind: event.target.value as typeof link.kind,
                          }
                        : item,
                    );
                    patch({ header: { ...config.header, links } });
                  }}
                >
                  <option value="home">{t("kindHome")}</option>
                  <option value="category">{t("kindCategory")}</option>
                  <option value="product">{t("kindProduct")}</option>
                  <option value="content">{t("kindContent")}</option>
                  <option value="external">{t("kindExternal")}</option>
                </select>
              </div>
              <input
                className={inputClass}
                placeholder={t("linkHref")}
                value={link.href}
                onChange={(event) => {
                  const links = config.header.links.map((item, i) =>
                    i === index ? { ...item, href: event.target.value } : item,
                  );
                  patch({ header: { ...config.header, links } });
                }}
              />
              <div className="flex flex-wrap items-center gap-1">
                <Toggle
                  compact
                  label={t("sectionVisible")}
                  checked={link.enabled}
                  onChange={(enabled) => {
                    const links = config.header.links.map((item, i) =>
                      i === index ? { ...item, enabled } : item,
                    );
                    patch({ header: { ...config.header, links } });
                  }}
                />
                <span className="ms-auto flex">
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveUp")}
                    onClick={() =>
                      patch({
                        header: {
                          ...config.header,
                          links: moveIndex(config.header.links, index, -1),
                        },
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveDown")}
                    onClick={() =>
                      patch({
                        header: {
                          ...config.header,
                          links: moveIndex(config.header.links, index, 1),
                        },
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${iconBtnClass} px-1.5`}
                    onClick={() =>
                      patch({
                        header: {
                          ...config.header,
                          links: config.header.links.filter(
                            (_, i) => i !== index,
                          ),
                        },
                      })
                    }
                  >
                    {t("removeLink")}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
          <div className="space-y-1 border border-border p-3">
            <button
              type="button"
              className={btnClass}
              data-nav-migrate=""
              onClick={() => {
                const { items, skipped } = migrateLegacyLinks(config.header.links);
                setSkippedLinks(skipped);
                patch({ navigation: withMainMenu(config.navigation, { ...emptyMainMenu(), items }) });
              }}
            >
              {t("navUseNewEditor")}
            </button>
            <p className="text-[12px] leading-5 text-muted">{t("navUseNewEditorHint")}</p>
          </div>
        </>
      )}
    </div>
  );
}

function HomepagePanel({
  config,
  t,
  patch,
  selectedSection = null,
  onSelectSection,
  activeSlides,
  onActiveSlideChange,
  isMobileViewport = false,
  featuredPickerSearch = "",
  featuredPickerListState = "idle",
  featuredPickerList = [],
  onFeaturedPickerSearchChange,
  onRetryFeaturedPickerList,
  featuredResolved = {},
  featuredResolvedState = {},
  onRetryFeaturedResolution,
  locale = "ar",
  timezone = DEFAULT_TENANT_TIMEZONE,
  offers = [],
  offersState = "idle",
  onRetryOffers,
  offerManagement,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  selectedSection?: string | null;
  onSelectSection?: (id: string | null) => void;
  /** CUST-HV V8c — the slide each slider section is showing (shared with the Canvas), by section id. */
  activeSlides?: Record<string, string>;
  onActiveSlideChange?: (sectionId: string, slideId: string) => void;
  isMobileViewport?: boolean;
  featuredPickerSearch?: string;
  featuredPickerListState?: "idle" | "loading" | "error" | "ready";
  featuredPickerList?: WorkspaceProductSummary[];
  onFeaturedPickerSearchChange?: (value: string) => void;
  onRetryFeaturedPickerList?: () => void;
  featuredResolved?: Record<string, WorkspaceProductSummary[]>;
  featuredResolvedState?: Record<string, "idle" | "loading" | "error" | "ready">;
  onRetryFeaturedResolution?: (sectionId: string) => void;
  locale?: CustomizerLocale;
  /** CUST-HV V6c-1 — the store's IANA zone; the Banner display window is entered in it. */
  timezone?: string;
  offers?: WorkspaceOffer[];
  offersState?: "idle" | "loading" | "error" | "ready";
  onRetryOffers?: () => void;
  offerManagement?: OfferManagement;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // CUST-HV V10d — drag and drop is an extra way to reorder; the up / down buttons remain the keyboard and touch path.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const sections = config.homepage.sections;
  const dragIndex = dragId ? sections.findIndex((item) => item.id === dragId) : -1;

  const setSections = (next: PresentationHomeSection[]) =>
    patch({ homepage: { ...config.homepage, sections: next } });

  // CUST-HV V10d — the list operations are the shared pure ops (`presentation/section-ops.ts`), also used by the Canvas action bar.
  const applyOp = (next: StorefrontPresentationConfig | null) => {
    if (next) patch({ homepage: next.homepage, apps: next.apps });
  };

  const move = (index: number, delta: number) => applyOp(moveSectionTo(config, index, index + delta));

  const setVisible = (index: number, visible: boolean) => {
    const current = sections[index];
    if (current) applyOp(setSectionVisible(config, current.id, visible));
  };

  const updateSection = (index: number, next: PresentationHomeSection) => {
    setSections(sections.map((item, i) => (i === index ? next : item)));
  };

  // Add (Section Picker): user-created instance — هذا هو الموضع الوحيد
  // المسموح فيه بتوليد id جديد (بعيدًا عن normalization). النسخة الجديدة
  // تُلحق بنهاية القائمة وتصبح selected مباشرة.
  const addSection = (type: HomeBuilderSectionKey) => {
    if (!canAddSectionType(sections, type)) return;
    const id = newHomeSectionId();
    // A hero added by the merchant never inherits the legacy global text (V0 §8.1.4): it starts
    // with its own, explicitly empty content — the store name and the default CTA until edited.
    const content = type === "hero" ? { headline: "" } : undefined;
    setSections([
      ...sections,
      { id, type, visible: true, ...(content ? { content } : {}) },
    ]);
    setPickerOpen(false);
    onSelectSection?.(id);
  };

  // Duplicate with design: content, design and a suffixed name, under a new id, right after the original; it becomes selected.
  const duplicateSection = (index: number) => {
    const source = sections[index];
    if (!source) return;
    const result = duplicateSectionOp(config, source.id, t("sectionCopySuffix"));
    if (!result) return;
    applyOp(result.config);
    onSelectSection?.(result.id);
  };

  // Delete: في عقد v2 إزالة الـinstance من homepage.sections هي الحذف
  // الحقيقي (لا resurrection). لا تُستخدم visible=false كبديل. الـselection
  // ينتقل deterministic: next sibling، وإلا previous، وإلا null.
  // CUST-HV V1B (DEF-6) — a section with authored content or design asks first;
  // an empty one is removed immediately, as before.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const requestDelete = (index: number) => {
    const target = sections[index];
    if (!target) return;
    const authored = sectionIsAuthored(target);
    if (authored) setPendingDelete(target.id);
    else deleteSection(index);
  };
  const deleteSection = (index: number) => {
    const removed = sections[index];
    if (!removed) return;
    setPendingDelete(null);
    const result = deleteSectionOp(config, removed.id);
    if (!result) return;
    applyOp(result.config);
    if (selectedSection === removed.id) onSelectSection?.(result.fallbackId);
  };

  const selectedIndex = selectedSection
    ? sections.findIndex((section) => section.id === selectedSection)
    : -1;
  const selected = selectedIndex >= 0 ? sections[selectedIndex] : null;
  // Content | Design for the selected section. Keyed by section id so a new
  // selection always opens on Content; sections with no design capability have no tab.
  const [tabState, setTabState] = useState<{
    id: string | null;
    tab: "content" | "design";
  }>({ id: null, tab: "content" });
  const designTab =
    selected &&
    SECTION_DESIGN_CAPABILITIES[selected.type] &&
    tabState.id === selected.id
      ? tabState.tab
      : "content";
  // CUST-HV V6b-4b — the server's proven bounds of every picture background, so the inspector's
  // verdict is the publish gate's own (read-only; a document without pictures fetches nothing).
  const backgroundBounds = useBackgroundMediaBounds(sections);
  const designContext: DesignContext = {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    palette: config.palette,
    dir: locale === "en" ? "ltr" : "rtl",
    mediaBounds: backgroundBounds.lookup,
  };

  // CUST-H4-2 mobile fix — on mobile the Library *replaces* this panel's
  // whole body in place, inside the same "sections" Bottom Sheet
  // `ExperienceBuilder.tsx` already opens, instead of stacking a second
  // centered dialog on top of it (never more than one aria-modal surface).
  // closeAction="back" (review fix — mobile UX polish): its header control
  // reads as "رجوع"/"Back", not a second "×" next to the sheet's own close
  // — it calls `onClose` (= `setPickerOpen(false)`), which simply falls
  // through to the normal return below, returning to the composer list
  // without exiting the sheet itself.
  if (pickerOpen && isMobileViewport) {
    return (
      <SectionLibraryContent
        sections={sections}
        t={t}
        onAdd={addSection}
        onClose={() => setPickerOpen(false)}
        closeAction="back"
      />
    );
  }

  return (
    <div className="space-y-7">
      {selected ? (
        <Section
          title={selected.label || t(SECTION_LABEL[selected.type])}
          hint={t("selectedSectionHint")}
        >
          <div
            data-selected-section-settings={selected.type}
            className="space-y-4"
          >
            <Toggle
              compact
              label={
                selected.visible ? t("sectionVisible") : t("sectionHidden")
              }
              checked={selected.visible}
              onChange={(visible) => setVisible(selectedIndex, visible)}
            />
            <Field label={t("sectionNameLabel")}>
              <BufferedText
                key={selected.id}
                value={selected.label ?? ""}
                limit={MAX_SECTION_LABEL}
                placeholder={t(SECTION_LABEL[selected.type])}
                onCommit={(text) => {
                  const { label: _previous, ...rest } = selected;
                  const label = stored(text);
                  updateSection(selectedIndex, label ? { ...rest, label: text } : rest);
                }}
                data-section-name=""
              />
            </Field>
            <p className="-mt-2 text-[11px] leading-4 text-muted">{t("sectionNameHelp")}</p>
            {SECTION_DESIGN_CAPABILITIES[selected.type] ? (
              <Segmented
                value={designTab}
                onChange={(tab) => setTabState({ id: selected.id, tab })}
                options={[
                  { id: "content", label: t("contentTab") },
                  { id: "design", label: t("designTab") },
                ]}
              />
            ) : null}
            {designTab === "design" ? (
              <>
                {selected.type === "categories" ? (
                  // AWJ-STORE-CAT-DESIGN-01 — the card display of the categories section sits above the generic section
                  // styling; both edit the same `design`, so reset / copy / paste / presets and undo cover them together.
                  <CategoriesDisplayFields
                    key={`${selected.id}-display`}
                    design={selected.design}
                    t={t}
                    onChange={(design) =>
                      updateSection(selectedIndex, {
                        ...selected,
                        design,
                      })
                    }
                  />
                ) : null}
                <DesignInspector
                  key={selected.id}
                  type={selected.type}
                  design={selected.design}
                  ctx={designContext}
                  t={t}
                  locale={locale === "en" ? "en" : "ar"}
                  bounds={backgroundBounds}
                  textless={isTextlessSection(selected)}
                  onChange={(design) =>
                    updateSection(selectedIndex, {
                      ...selected,
                      design,
                    })
                  }
                />
              </>
            ) : selected.type === "hero" ? (
              <HeroFields
                key={selected.id}
                content={heroContentOf(selected)}
                legacy={{
                  headline: config.homepage.heroHeadline,
                  subheadline: config.homepage.heroSubheadline,
                }}
                design={selected.design}
                ctx={designContext}
                t={t}
                onChange={(content) =>
                  updateSection(selectedIndex, { ...selected, content })
                }
              />
            ) : selected.type === "banner" ? (
              <BannerFields
                key={selected.id}
                sectionId={selected.id}
                content={bannerContentOf(selected)}
                design={selected.design}
                ctx={designContext}
                locale={locale}
                timezone={timezone}
                t={t}
                onChange={(content) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: isBannerEmpty(content) ? undefined : content,
                  })
                }
              />
            ) : selected.type === "slider" ? (
              <SliderFields
                key={selected.id}
                content={sliderContentOf(selected)}
                ctx={designContext}
                bounds={backgroundBounds}
                locale={locale === "en" ? "en" : "ar"}
                t={t}
                activeSlideId={activeSlides?.[selected.id] ?? null}
                onActiveSlideChange={(slideId) => onActiveSlideChange?.(selected.id, slideId)}
                onChange={(content) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: content.slides.length > 0 ? content : undefined,
                  })
                }
              />
            ) : selected.type === "gallery" ? (
              <GalleryFields
                key={selected.id}
                content={galleryContentOf(selected)}
                locale={locale === "en" ? "en" : "ar"}
                t={t}
                activeImageId={activeSlides?.[selected.id] ?? null}
                onActiveImageChange={(imageId) => onActiveSlideChange?.(selected.id, imageId)}
                onChange={(content) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: content.images.length > 0 ? content : undefined,
                  })
                }
              />
            ) : selected.type === "benefits" ? (
              <BenefitsFields
                key={selected.id}
                items={benefitsContentOf(selected).items}
                t={t}
                locale={locale === "en" ? "en" : "ar"}
                onChange={(items) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: items.length ? { items } : undefined,
                  })
                }
              />
            ) : selected.type === "customContent" ? (
              <ContentBlocksFields
                key={selected.id}
                content={customContentOf(selected)}
                locale={locale === "en" ? "en" : "ar"}
                t={t}
                activeBlockId={activeSlides?.[selected.id] ?? null}
                onActiveBlockChange={(blockId) => onActiveSlideChange?.(selected.id, blockId)}
                onChange={(content) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: content.blocks.length ? content : undefined,
                  })
                }
              />
            ) : selected.type === "newArrivals" ? (
              <ShelfTitleFields
                key={selected.id}
                content={newArrivalsContentOf(selected)}
                t={t}
                onChange={(content) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: Object.keys(content).length ? content : undefined,
                  })
                }
              />
            ) : selected.type === "featured" ? (
              <>
              <ShelfTitleFields
                key={`${selected.id}-title`}
                content={featuredContentOf(selected)}
                t={t}
                onChange={(own) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: shelfContent(
                      { productIds: featuredContentOf(selected).productIds },
                      own,
                    ),
                  })
                }
              />
              <FeaturedPickerFields
                productIds={featuredContentOf(selected).productIds}
                t={t}
                onChange={(productIds) => {
                  const own = featuredContentOf(selected);
                  updateSection(selectedIndex, {
                    ...selected,
                    content: shelfContent(
                      { productIds },
                      { title: own.title, showTitle: own.showTitle },
                    ),
                  });
                }}
                search={featuredPickerSearch}
                listState={featuredPickerListState}
                list={featuredPickerList}
                onSearchChange={onFeaturedPickerSearchChange}
                onRetryList={onRetryFeaturedPickerList}
                selectedProducts={featuredResolved[selected.id] ?? []}
                selectedState={featuredResolvedState[selected.id] ?? "idle"}
                onRetrySelected={() => onRetryFeaturedResolution?.(selected.id)}
              />
              </>
            ) : selected.type === "offers" ? (
              <>
              <ShelfTitleFields
                key={`${selected.id}-title`}
                content={offersContentOf(selected)}
                t={t}
                onChange={(own) =>
                  updateSection(selectedIndex, {
                    ...selected,
                    content: shelfContent(
                      { offerIds: offersContentOf(selected).offerIds },
                      own,
                    ),
                  })
                }
              />
              <OffersPickerFields
                offerIds={offersContentOf(selected).offerIds}
                t={t}
                locale={locale}
                onChange={(offerIds) => {
                  const own = offersContentOf(selected);
                  updateSection(selectedIndex, {
                    ...selected,
                    content: shelfContent(
                      { offerIds },
                      { title: own.title, showTitle: own.showTitle },
                    ),
                  });
                }}
                offers={offers}
                state={offersState}
                onRetry={onRetryOffers}
                management={offerManagement}
              />
              </>
            ) : selected.type === "productShelf" ? (
              <ProductShelfFields
                key={selected.id}
                content={productShelfContentOf(selected)}
                locale={locale}
                t={t}
                onChange={(content) =>
                  updateSection(selectedIndex, { ...selected, content })
                }
              />
            ) : selected.type === "discovery" ? (
              <DiscoveryFields
                key={selected.id}
                content={discoveryContentOf(selected)}
                locale={locale}
                t={t}
                storeVars={
                  presentationCssVars(config.primaryColor, config.radius, config.accentColor, config.backgroundColor) as CSSProperties
                }
                onChange={(content) =>
                  updateSection(selectedIndex, { ...selected, content })
                }
              />
            ) : selected.type === "deliveryPromise" ? (
              <DeliveryPromiseFields
                key={selected.id}
                content={deliveryPromiseContentOf(selected)}
                t={t}
                onChange={(content) =>
                  updateSection(selectedIndex, { ...selected, content })
                }
              />
            ) : selected.type === "appPromo" ? (
              <AppPromoFields config={config} t={t} patch={patch} />
            ) : isGatedHomeSection(selected.type) ? (
              <p className="text-xs leading-relaxed text-neutral-500">
                {t("gatedSection")}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-neutral-500">
                {t("sectionManagedNote")}
              </p>
            )}
          </div>
        </Section>
      ) : null}
      <Section title={t("composerTitle")} hint={t("composerHint")}>
        <div className="mb-2">
          <button
            type="button"
            data-add-section=""
            disabled={
              !hasAddableSectionType(sections) ||
              sections.length >= MAX_HOME_SECTIONS
            }
            title={
              sections.length >= MAX_HOME_SECTIONS
                ? t("sectionLimitReached")
                : undefined
            }
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
            className={`${btnClass} w-full justify-center disabled:opacity-50`}
          >
            + {t("addSection")}
          </button>
          {pickerOpen ? (
            <SectionLibraryDialog
              sections={sections}
              t={t}
              onAdd={addSection}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </div>
        <ul className="border border-neutral-200">
          {sections.map((section, index) => {
            const isSelected = selectedSection === section.id;
            return (
            <li
              key={section.id}
              data-composer-section={section.type}
              data-section-id={section.id}
              data-dragging={dragId === section.id ? "" : undefined}
              data-drop-target={dragId && dragId !== section.id && overId === section.id ? (dragIndex < index ? "after" : "before") : undefined}
              draggable
              onDragStart={(event) => {
                setDragId(section.id);
                event.dataTransfer?.setData("text/plain", section.id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                if (overId !== section.id) setOverId(section.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = sections.findIndex((item) => item.id === dragId);
                applyOp(moveSectionTo(config, from, index));
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={`flex h-12 items-center gap-1 border-b border-neutral-200 px-1 last:border-b-0 data-[dragging]:opacity-40 data-[drop-target=before]:shadow-[inset_0_2px_0_0_var(--primary)] data-[drop-target=after]:shadow-[inset_0_-2px_0_0_var(--primary)] ${
                isSelected
                  ? "border-s-2 border-s-primary bg-primary-soft ps-0.5"
                  : ""
              }`}
            >
              <span
                aria-hidden="true"
                data-drag-handle=""
                title={t("dragToReorder")}
                className="hidden shrink-0 cursor-grab select-none px-0.5 text-[14px] leading-none text-neutral-400 active:cursor-grabbing md:inline"
              >
                ⋮⋮
              </span>
              <div className="flex">
                <button
                  type="button"
                  aria-label={t("moveUp")}
                  disabled={index === 0}
                  className={iconBtnClass}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t("moveDown")}
                  disabled={index === sections.length - 1}
                  className={iconBtnClass}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                data-section-option={section.type}
                aria-pressed={isSelected}
                title={section.label ? `${section.label} · ${t(SECTION_LABEL[section.type])}` : t(SECTION_LABEL[section.type])}
                onClick={() => onSelectSection?.(section.id)}
                className="min-w-0 flex-1 rounded-sm px-1 py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <p
                  className={`truncate text-[13px] text-neutral-900 ${
                    isSelected ? "font-semibold" : "font-medium"
                  }`}
                >
                  <bdi>{section.label || t(SECTION_LABEL[section.type])}</bdi>
                </p>
                {section.label ? (
                  <p className="truncate text-[10px] leading-none text-neutral-400" data-section-type-hint="">
                    {t(SECTION_LABEL[section.type])}
                  </p>
                ) : null}
                {isGatedHomeSection(section.type) ? (
                  <p className="text-[10px] leading-none text-neutral-400">
                    {t("gatedBadge")}
                  </p>
                ) : null}
              </button>
              {canDuplicateSection(sections, section) ? (
                <button
                  type="button"
                  aria-label={t("duplicateSection")}
                  title={t("duplicateSection")}
                  className={iconBtnClass}
                  onClick={() => duplicateSection(index)}
                >
                  ⧉
                </button>
              ) : null}
              {canDeleteSection(section) ? (
                <button
                  type="button"
                  aria-label={t("deleteSection")}
                  title={t("deleteSection")}
                  className={iconBtnClass}
                  onClick={() => requestDelete(index)}
                >
                  ✕
                </button>
              ) : null}
              <Toggle
                compact
                label={
                  section.visible ? t("sectionVisible") : t("sectionHidden")
                }
                checked={section.visible}
                onChange={(visible) => setVisible(index, visible)}
              />
            </li>
            );
          })}
        </ul>
        {pendingDelete ? (
          <div
            data-delete-confirm=""
            role="alertdialog"
            aria-labelledby="delete-section-title"
            aria-describedby="delete-section-body"
            onKeyDown={(event) => {
              if (event.key === "Escape") setPendingDelete(null);
            }}
            className="mt-2 space-y-2 border border-negative bg-surface p-3"
          >
            <p id="delete-section-title" className="text-[13px] font-semibold text-text">
              {t("deleteSectionConfirmTitle")}
            </p>
            <p id="delete-section-body" className="text-[12px] leading-5 text-muted">
              {t("deleteSectionConfirmBody")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-delete-confirm-yes=""
                onClick={() => {
                  const index = sections.findIndex((item) => item.id === pendingDelete);
                  if (index >= 0) deleteSection(index);
                  else setPendingDelete(null);
                }}
                className={`${btnClass} border-negative text-negative`}
              >
                {t("deleteSectionConfirm")}
              </button>
              <button
                type="button"
                data-delete-confirm-cancel=""
                autoFocus
                onClick={() => setPendingDelete(null)}
                className={btnClass}
              >
                {t("deleteSectionCancel")}
              </button>
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function FooterPanel({
  config,
  t,
  patch,
  locale,
  storefrontId = null,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  locale: "ar" | "en";
  storefrontId?: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="border-y border-neutral-200">
        <Toggle
          label={t("showFooterLogo")}
          checked={config.footer.showLogo}
          onChange={(showLogo) =>
            patch({ footer: { ...config.footer, showLogo } })
          }
        />
      </div>
      <Field label={t("footerTagline")}>
        <textarea
          className={`${inputClass} h-20 py-2`}
          value={config.footer.tagline}
          onChange={(event) =>
            patch({ footer: { ...config.footer, tagline: event.target.value } })
          }
        />
      </Field>
      <Field label={t("footerCopyright")}>
        <input
          className={inputClass}
          value={config.footer.copyright}
          onChange={(event) =>
            patch({
              footer: { ...config.footer, copyright: event.target.value },
            })
          }
        />
      </Field>
      <FooterEditor config={config} t={t} locale={locale} storefrontId={storefrontId} patch={patch} />
    </div>
  );
}

function ContactPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const set = (
    key: keyof StorefrontPresentationConfig["contact"],
    value: string,
  ) => patch({ contact: { ...config.contact, [key]: value } });
  return (
    <div className="space-y-6">
      <Section hint={t("contactIntro")}>
        <Field label={t("phone")}>
          <input
            className={inputClass}
            value={config.contact.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field label={t("email")}>
          <input
            className={inputClass}
            value={config.contact.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label={t("address")}>
          <textarea
            className={`${inputClass} h-16 py-2`}
            value={config.contact.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field label={t("hours")}>
          <input
            className={inputClass}
            value={config.contact.hours}
            onChange={(e) => set("hours", e.target.value)}
          />
        </Field>
      </Section>
    </div>
  );
}

function WhatsAppPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const href = buildWhatsAppUrl(config.whatsapp.phone, config.whatsapp.message);
  return (
    <div className="space-y-6">
      <p className="text-[12px] leading-5 text-neutral-500">
        {t("whatsappIntro")}
      </p>
      <div className="border-y border-neutral-200">
        <Toggle
          label={t("whatsappEnable")}
          checked={config.whatsapp.enabled}
          onChange={(enabled) =>
            patch({ whatsapp: { ...config.whatsapp, enabled } })
          }
        />
      </div>
      <Section title={t("whatsappDetails")}>
        <Field
          label={t("whatsappPhone")}
          hint={href ? undefined : t("whatsappInvalid")}
        >
          <input
            className={inputClass}
            value={config.whatsapp.phone}
            onChange={(event) =>
              patch({
                whatsapp: { ...config.whatsapp, phone: event.target.value },
              })
            }
          />
        </Field>
        <Field label={t("whatsappMessage")}>
          <textarea
            className={`${inputClass} h-16 py-2`}
            value={config.whatsapp.message}
            onChange={(event) =>
              patch({
                whatsapp: { ...config.whatsapp, message: event.target.value },
              })
            }
          />
        </Field>
      </Section>
      <Field label={t("whatsappPlacement")}>
        <Segmented
          value={config.whatsapp.placement}
          onChange={(placement) =>
            patch({ whatsapp: { ...config.whatsapp, placement } })
          }
          options={[
            { id: "floating" as const, label: t("placementFloating") },
            { id: "footer" as const, label: t("placementFooter") },
            { id: "both" as const, label: t("placementBoth") },
          ]}
        />
      </Field>
      <div className="border-t border-neutral-200 pt-3">
        <p className="font-mono text-[11px] leading-5 break-all text-neutral-500">
          {t("whatsappPreview")}: {href ?? "—"}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-neutral-500">
          {t("whatsappNoSend")}
        </p>
      </div>
    </div>
  );
}

/**
 * `normalizePresentationConfig` drops a URL that is not yet a complete https link, so a URL typed key by key reads `""` in the draft until
 * its last character. Fields bound through `BufferedText` compare against this instead of echoing the draft back over the caret.
 */
const externalUrlText = (typed: string) => sanitizeExternalUrl(typed) ?? "";

// Mirrors of `normalizeBanner` / `normalizeBenefits` (section-content.ts) for the buffered fields below: `trim().slice(0, n)`.
const bannerTitleText = (typed: string) => typed.trim().slice(0, 120);
const bannerSubtitleText = (typed: string) => typed.trim().slice(0, 200);
const benefitTitleText = (typed: string) => typed.trim().slice(0, 80);
const benefitBodyText = (typed: string) => typed.trim().slice(0, 200);

function SocialPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-wide text-neutral-500">
          {t("social")}
        </span>
        <button
          type="button"
          className={btnClass}
          onClick={() =>
            patch({
              social: [
                ...config.social,
                {
                  id: `social-${Date.now()}`,
                  network: "instagram" as const,
                  url: "",
                  enabled: true,
                },
              ].slice(0, 8),
            })
          }
        >
          {t("addSocial")}
        </button>
      </div>
      {config.social.length === 0 ? (
        <p className="text-[12px] text-neutral-500">{t("noSocial")}</p>
      ) : (
        <ul className="border border-neutral-200">
          {config.social.map((item, index) => (
            <li
              key={item.id}
              className="space-y-2 border-b border-neutral-200 p-3 last:border-b-0"
            >
              <div className="flex gap-2">
                <select
                  className={selectClass}
                  value={item.network}
                  onChange={(event) => {
                    const social = config.social.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            network: event.target.value as SocialNetwork,
                          }
                        : row,
                    );
                    patch({ social });
                  }}
                >
                  {SOCIAL_NETWORKS.map((network) => (
                    <option key={network} value={network}>
                      {network}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() =>
                    patch({
                      social: config.social.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t("removeLink")}
                </button>
              </div>
              <BufferedText
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                value={item.url}
                normalize={externalUrlText}
                reconcileOnBlur
                onCommit={(url) => {
                  const social = config.social.map((row, i) => (i === index ? { ...row, url } : row));
                  patch({ social });
                }}
              />
              <div className="flex items-center gap-1">
                <Toggle
                  compact
                  label={t("sectionVisible")}
                  checked={item.enabled}
                  onChange={(enabled) => {
                    const social = config.social.map((row, i) =>
                      i === index ? { ...row, enabled } : row,
                    );
                    patch({ social });
                  }}
                />
                <span className="ms-auto flex">
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveUp")}
                    onClick={() =>
                      patch({ social: moveIndex(config.social, index, -1) })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveDown")}
                    onClick={() =>
                      patch({ social: moveIndex(config.social, index, 1) })
                    }
                  >
                    ↓
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerificationPanel({
  config,
  t,
  patch,
  businessIdentity,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  businessIdentity?: {
    legal_name: string | null;
    cr_number: string | null;
    vat_number: string | null;
  };
}) {
  const canonicalLegalName = businessIdentity?.legal_name?.trim() || null;
  const canonicalCrNumber = businessIdentity?.cr_number?.trim() || null;
  const canonicalVatNumber = businessIdentity?.vat_number?.trim() || null;

  return (
    <div className="space-y-6">
      <Section title={t("sbcTitle")} hint={t("sbcIntro")}>
        <Field label={t("sbcAuthenticationNumber")} hint={t("sbcAuthenticationHint")}>
          <input
            className={inputClass}
            value={config.sbc.authentication_number}
            onChange={(event) =>
              patch({
                sbc: {
                  ...config.sbc,
                  authentication_number: event.target.value,
                },
              })
            }
          />
        </Field>
        <Field label={t("sbcSealToken")} hint={t("sbcSealTokenHint")}>
          <input
            className={inputClass}
            value={config.sbc.seal_token}
            onChange={(event) =>
              patch({
                sbc: {
                  ...config.sbc,
                  seal_token: event.target.value,
                },
              })
            }
          />
        </Field>
        <div className="border-y border-neutral-200">
          <Toggle
            label={t("sbcShowInStorefront")}
            checked={config.sbc.show_in_storefront}
            onChange={(show_in_storefront) =>
              patch({ sbc: { ...config.sbc, show_in_storefront } })
            }
          />
        </div>
      </Section>
      <Section title={t("businessInformation")} hint={t("canonicalIdentityHint")}>
        <Field label={t("legalName")}>
          <output
            className={`${inputClass} block bg-neutral-50 text-neutral-700`}
            aria-readonly="true"
          >
            {canonicalLegalName || "—"}
          </output>
        </Field>
        <Field label={t("crNumber")}>
          <output
            className={`${inputClass} block bg-neutral-50 text-neutral-700`}
            aria-readonly="true"
            dir="ltr"
          >
            {canonicalCrNumber || "—"}
          </output>
        </Field>
        <Field label={t("vatNumber")}>
          <output
            className={`${inputClass} block bg-neutral-50 text-neutral-700`}
            aria-readonly="true"
            dir="ltr"
          >
            {canonicalVatNumber || "—"}
          </output>
        </Field>
        <a
          href="/settings"
          className="inline-flex text-[12px] font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("businessInformationSettings")}
        </a>
      </Section>
      <Section title={t("merchantProvided")}>
        <Field label={t("licenseNumber")}>
          <input
            className={inputClass}
            value={config.verification.licenseNumber}
            onChange={(event) =>
              patch({
                verification: {
                  ...config.verification,
                  licenseNumber: event.target.value,
                },
              })
            }
          />
        </Field>
        <Field label={t("verificationUrl")}>
          <BufferedText
            dir="ltr"
            inputMode="url"
            value={config.verification.sourceUrl}
            normalize={externalUrlText}
                reconcileOnBlur
            onCommit={(sourceUrl) =>
              patch({
                verification: {
                  ...config.verification,
                  sourceUrl,
                },
              })
            }
          />
        </Field>
      </Section>
    </div>
  );
}

function AppsPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-6">
      <Section hint={t("appsIntro")}>
        <Field label={t("appName")}>
          <input
            className={inputClass}
            value={config.apps.appName}
            onChange={(event) =>
              patch({ apps: { ...config.apps, appName: event.target.value } })
            }
          />
        </Field>
        <DeferredCommitField
          label={t("iosUrl")}
          placeholder="https://apps.apple.com/..."
          value={config.apps.iosUrl}
          onCommit={(iosUrl) => patch({ apps: { ...config.apps, iosUrl } })}
        />
        <DeferredCommitField
          label={t("androidUrl")}
          placeholder="https://play.google.com/..."
          value={config.apps.androidUrl}
          onCommit={(androidUrl) => patch({ apps: { ...config.apps, androidUrl } })}
        />
      </Section>
      <Section title={t("appsPlacement")}>
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          <Toggle
            label={t("showAppHome")}
            checked={config.apps.showHomepageSection}
            onChange={(showHomepageSection) => {
              const sections = config.homepage.sections;
              const has = sections.some((section) => section.type === "appPromo");
              const nextSections = showHomepageSection && !has
                ? [
                    ...sections,
                    {
                      id: newHomeSectionId(),
                      type: "appPromo" as const,
                      visible: true,
                    },
                  ]
                : sections.map((section) =>
                    section.type === "appPromo"
                      ? { ...section, visible: showHomepageSection }
                      : section,
                  );
              patch({
                apps: { ...config.apps, showHomepageSection },
                homepage: { ...config.homepage, sections: nextSections },
              });
            }}
          />
          <Toggle
            label={t("showAppFooter")}
            checked={config.apps.showFooterLinks}
            onChange={(showFooterLinks) =>
              patch({ apps: { ...config.apps, showFooterLinks } })
            }
          />
        </div>
      </Section>
    </div>
  );
}

function isBannerEmpty(content: BannerContent): boolean {
  return (
    !content.title &&
    !content.subtitle &&
    !content.ctaLabel &&
    !content.ctaHref &&
    !content.imageUrl &&
    !content.ctas?.length
  );
}

/**
 * CUST-HV V6a — one hero instance's own content: headline, supporting line and up to two
 * buttons. A hero that still has no content shows the legacy global text as its starting values;
 * the first edit writes explicit content and the globals are no longer read for that instance.
 */
/**
 * CUST-HV V6a/V6c-2 — the two call-to-action slots shared by Hero and Banner (V0 §8.2: ≤ 2, label + link). The
 * caller owns what an empty slot means. The link is sanitised on every commit (a half-typed `https://…` becomes
 * ""), so it is edited locally and committed on blur — the same deferred field the app-store URLs use.
 */
type CtaSlot = { label: string; href: string; style?: CtaStyle; colour?: CtaColour };

const CTA_STYLE_LABEL = {
  solid: "ctaStyleSolid",
  soft: "ctaStyleSoft",
  outline: "ctaStyleOutline",
  link: "ctaStyleLink",
} as const satisfies Record<CtaStyle, CustomizerMessageKey>;

const CTA_COLOUR_LABEL = {
  brand: "ctaColourBrand",
  accent: "ctaColourAccent",
  text: "ctaColourText",
} as const satisfies Record<CtaColour, CustomizerMessageKey>;

/** What the publish gate would say about the buttons of a section (for the editor's live advisory). */
type CtaJudge = (ctas: CtaSlot[]) => CtaColourIssue[];

function CtaSlots({
  slots,
  slotAttr,
  t,
  onChange,
  judge,
}: {
  slots: CtaSlot[];
  slotAttr: "data-hero-cta-slot" | "data-banner-cta-slot";
  t: (key: CustomizerMessageKey) => string;
  onChange: (next: CtaSlot[]) => void;
  judge?: CtaJudge;
}) {
  // The gate numbers the STORED buttons (empty slots are not stored): map its verdict back onto the slots.
  const stored = slots.map((slot, slotIndex) => ({ slot, slotIndex })).filter(({ slot }) => slot.label !== "" || slot.href !== "");
  const verdict = new Map<number, CtaColourIssue["code"]>();
  if (judge) {
    for (const issue of judge(stored.map(({ slot }) => slot))) verdict.set(stored[issue.index].slotIndex, issue.code);
  }
  const setSlot = (index: number, partial: Partial<CtaSlot>) =>
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...partial } : slot)));
  // Default = by position (first solid, second outline): the key is removed, never stored as undefined.
  const setStyle = (index: number, style: CtaStyle | "") =>
    onChange(
      slots.map((slot, i) => {
        if (i !== index) return slot;
        const { style: _previous, ...rest } = slot;
        if (style === "") return rest;
        // `soft` is a tint of a role colour: choosing it without one picks the brand colour (never a silent no-op)
        return { ...rest, style, ...(style === "soft" && !rest.colour ? { colour: "brand" as const } : {}) };
      }),
    );
  const setColour = (index: number, colour: CtaColour | "") =>
    onChange(
      slots.map((slot, i) => {
        if (i !== index) return slot;
        const { colour: _previous, ...rest } = slot;
        return colour === "" ? rest : { ...rest, colour };
      }),
    );
  return (
    <>
      {slots.map((cta, index) => (
        <fieldset key={index} className="min-w-0 space-y-2" {...{ [slotAttr]: index }}>
          <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
            {t(index === 0 ? "heroCtaPrimary" : "heroCtaSecondary")}
          </legend>
          <Field label={t("heroCtaLabel")}>
            <input
              className={inputClass}
              value={cta.label}
              onChange={(event) => setSlot(index, { label: event.target.value })}
            />
          </Field>
          <DeferredCommitField
            label={t("heroCtaHref")}
            value={cta.href}
            dir="ltr"
            onCommit={(href) => setSlot(index, { href })}
          />
          <Field label={t("ctaStyle")}>
            <select
              className={selectClass}
              data-cta-style-select=""
              value={cta.style ?? ""}
              // an empty slot is not stored, so a look chosen for it would vanish: offer it once the button exists
              disabled={cta.label === "" && cta.href === ""}
              onChange={(event) => setStyle(index, event.target.value as CtaStyle | "")}
            >
              <option value="">{t("ctaStyleDefault")}</option>
              {CTA_STYLES.map((style) => (
                <option key={style} value={style}>
                  {t(CTA_STYLE_LABEL[style])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ctaColour")}>
            <select
              className={selectClass}
              data-cta-colour-select=""
              value={cta.colour ?? ""}
              disabled={cta.label === "" && cta.href === ""}
              onChange={(event) => setColour(index, event.target.value as CtaColour | "")}
            >
              <option value="">{t("ctaColourDefault")}</option>
              {CTA_COLOURS.map((colour) => (
                <option key={colour} value={colour}>
                  {t(CTA_COLOUR_LABEL[colour])}
                </option>
              ))}
            </select>
          </Field>
          {verdict.has(index) ? (
            <p data-cta-colour-issue={verdict.get(index)} role="status" className="text-[12px] leading-5 text-warning">
              {t(verdict.get(index) === "contrast_unprovable" ? "ctaColourUnprovable" : "ctaColourInsufficient")}
            </p>
          ) : null}
        </fieldset>
      ))}
    </>
  );
}

function HeroFields({
  content,
  legacy,
  design,
  ctx,
  t,
  onChange,
}: {
  content: HeroContent | undefined;
  legacy: { headline: string; subheadline: string };
  design?: SectionDesign;
  ctx: DesignContext;
  t: (key: CustomizerMessageKey) => string;
  onChange: (content: HeroContent) => void;
}) {
  const value: HeroContent = content ?? legacyHeroContent({
    heroHeadline: legacy.headline,
    heroSubheadline: legacy.subheadline,
  });
  const ctas: CtaSlot[] = [0, 1].map((index) => value.ctas?.[index] ?? { label: "", href: "" });
  const commit = (next: {
    headline: string;
    subheadline: string;
    ctas: CtaSlot[];
    showTitle: boolean;
    showSubheadline: boolean;
    showCtas: boolean;
    imageHref: string;
  }) => {
    // an empty slot is not stored; the remaining buttons keep their order
    const kept = next.ctas.filter((cta) => cta.label !== "" || cta.href !== "");
    onChange({
      headline: next.headline,
      ...(next.subheadline !== "" ? { subheadline: next.subheadline } : {}),
      ...(kept.length > 0 ? { ctas: kept } : {}),
      // AWJ-HERO-DISPLAY — a switch is stored only while OFF (`false`); turning it on removes the key, so a hero
      // that never hid anything keeps exactly the document it had.
      ...(next.showTitle ? {} : { showTitle: false as const }),
      ...(next.showSubheadline ? {} : { showSubheadline: false as const }),
      ...(next.showCtas ? {} : { showCtas: false as const }),
      ...(next.imageHref !== "" ? { imageHref: next.imageHref } : {}),
    });
  };
  const state = {
    headline: value.headline,
    subheadline: value.subheadline ?? "",
    ctas,
    showTitle: value.showTitle !== false,
    showSubheadline: value.showSubheadline !== false,
    showCtas: value.showCtas !== false,
    imageHref: value.imageHref ?? "",
  };
  const imageOnly = !state.showTitle && !state.showSubheadline && !state.showCtas;
  return (
    <div className="space-y-3" data-hero-fields="">
      <div className="divide-y divide-neutral-200 border-y border-neutral-200" data-hero-display="">
        <Toggle
          label={t("heroShowTitle")}
          checked={state.showTitle}
          onChange={(showTitle) => commit({ ...state, showTitle })}
        />
        <Toggle
          label={t("heroShowSubheadline")}
          checked={state.showSubheadline}
          onChange={(showSubheadline) => commit({ ...state, showSubheadline })}
        />
        <Toggle
          label={t("heroShowCtas")}
          checked={state.showCtas}
          onChange={(showCtas) => commit({ ...state, showCtas })}
        />
      </div>
      {imageOnly ? (
        <p className="text-[12px] leading-5 text-muted" data-hero-image-only="">
          {t("heroImageOnlyHint")}
        </p>
      ) : null}
      <DeferredCommitField
        label={t("heroImageHref")}
        value={state.imageHref}
        dir="ltr"
        onCommit={(imageHref) => commit({ ...state, imageHref })}
      />
      <p className="text-[12px] leading-5 text-muted">{t("heroImageHrefHint")}</p>
      <Field label={t("heroHeadline")}>
        <input
          className={inputClass}
          value={state.headline}
          onChange={(event) => commit({ ...state, headline: event.target.value })}
        />
      </Field>
      <Field label={t("heroSubheadline")}>
        <input
          className={inputClass}
          value={state.subheadline}
          onChange={(event) => commit({ ...state, subheadline: event.target.value })}
        />
      </Field>
      <CtaSlots
        slots={ctas}
        slotAttr="data-hero-cta-slot"
        t={t}
        // hidden buttons are not drawn, so their colours are not judged (the publish gate skips them the same way)
        judge={(list) => (state.showCtas ? ctaColourIssues("hero", list, design, ctx) : [])}
        onChange={(next) => commit({ ...state, ctas: next })}
      />
      <p className="text-[12px] leading-5 text-muted">{t("heroCtaHint")}</p>
    </div>
  );
}

function BannerFields({
  sectionId,
  content,
  design,
  ctx,
  locale,
  timezone,
  t,
  onChange,
}: {
  sectionId: string;
  content: BannerContent;
  design?: SectionDesign;
  ctx: DesignContext;
  locale: CustomizerLocale;
  timezone: string;
  t: (key: CustomizerMessageKey) => string;
  onChange: (content: BannerContent) => void;
}) {
  const value = content ?? emptyBannerContent();
  const set = (partial: Partial<BannerContent>) => onChange({ ...value, ...partial });
  // CUST-HV V6c-2 — `ctas` when authored, else the legacy pair (= ctas[0]); two slots always shown.
  const effective = bannerCtasOf(value);
  const bannerSlots: CtaSlot[] = [0, 1].map((index) => effective[index] ?? { label: "", href: "" });
  const commitBannerCtas = (next: CtaSlot[]) => {
    // an empty slot is not stored; the remaining buttons keep their order. `ctas[0]` is mirrored into the legacy
    // pair so an older reader (which ignores `ctas`) still shows the first button.
    const kept = next.filter((cta) => cta.label !== "" || cta.href !== "");
    const { ctas: _previous, ...rest } = value;
    onChange({
      ...rest,
      ctaLabel: kept[0]?.label ?? "",
      ctaHref: kept[0]?.href ?? "",
      ...(kept.length > 0 ? { ctas: kept } : {}),
    });
  };
  return (
    <div className="space-y-3">
      <Field label={t("bannerTitle")}>
        <BufferedText value={value.title} maxLength={120} normalize={bannerTitleText} onCommit={(title) => set({ title })} />
      </Field>
      <Field label={t("bannerSubtitle")}>
        <BufferedText multiline className="h-20 py-2" value={value.subtitle} maxLength={200} normalize={bannerSubtitleText} onCommit={(subtitle) => set({ subtitle })} />
      </Field>
      <CtaSlots
        slots={bannerSlots}
        slotAttr="data-banner-cta-slot"
        t={t}
        judge={(list) => ctaColourIssues("banner", list, design, ctx)}
        onChange={commitBannerCtas}
      />
      <p className="text-[12px] leading-5 text-muted">{t("bannerCtaHint")}</p>
      <Field label={t("bannerImageUrl")}>
        <BufferedText
          dir="ltr"
          inputMode="url"
          value={value.imageUrl ?? ""}
          normalize={externalUrlText}
          reconcileOnBlur
          onCommit={(imageUrl) => set({ imageUrl: imageUrl || null })}
        />
      </Field>
      <DeferredCommitField
        label={t("bannerImageAlt")}
        hint={t("bannerImageAltHint")}
        value={value.imageAlt ?? ""}
        onCommit={(imageAlt) => set({ imageAlt })}
      />
      {isBannerEmpty(value) ? (
        // The normaliser never keeps a window on a banner with nothing to show,
        // so the editor would silently lose it — say so instead of offering it.
        <p className="text-[12px] leading-5 text-muted">{t("bannerWindowNeedsContent")}</p>
      ) : (
        <>
          <WindowFields
            scope={sectionId}
            window={value.window}
            locale={locale}
            timezone={timezone}
            // Invalidity is structural (malformed / end ≤ start), never clock-dependent.
            invalid={announcementWindowState(value.window, 0) === "invalid"}
            t={t}
            onChange={(window) => {
              const { window: _previous, ...rest } = value;
              onChange(window ? { ...rest, window } : rest);
            }}
          />
          <p className="text-[12px] leading-5 text-muted">{t("bannerWindowHint")}</p>
        </>
      )}
    </div>
  );
}

export function BenefitsFields({
  items,
  t,
  locale,
  onChange,
}: {
  items: BenefitItem[];
  t: (key: CustomizerMessageKey) => string;
  locale: "ar" | "en";
  onChange: (items: BenefitItem[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-muted">{t("benefitsLayoutNote")}</p>
      {items.map((item, index) => (
        <div key={item.id} className="space-y-2 border border-neutral-200 p-2" data-benefit-row="">
          <Field label={t("navItemIcon")}>
            <select
              className={selectClass}
              data-benefit-icon-select=""
              value={item.icon ?? ""}
              onChange={(event) => {
                const icon = normalizeIconKey(event.target.value);
                onChange(
                  items.map((row, i) => {
                    if (i !== index) return row;
                    const { icon: _drop, ...rest } = row;
                    return icon ? { ...rest, icon } : rest;
                  }),
                );
              }}
            >
              <option value="">{t("navIconNone")}</option>
              {ICON_KEYS.map((key) => (
                <option key={key} value={key}>
                  {iconLabel(key, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("benefitTitle")}>
            <BufferedText
              value={item.title}
              maxLength={80}
              normalize={benefitTitleText}
              onCommit={(title) => onChange(items.map((row, i) => (i === index ? { ...row, title } : row)))}
            />
          </Field>
          <Field label={t("benefitBody")}>
            <BufferedText
              multiline
              className="h-16 py-2"
              value={item.body}
              maxLength={200}
              normalize={benefitBodyText}
              onCommit={(body) => onChange(items.map((row, i) => (i === index ? { ...row, body } : row)))}
            />
          </Field>
          <button type="button" className="text-xs text-neutral-500" onClick={() => onChange(items.filter((_, i) => i !== index))}>
            {t("removeItem")}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={items.length >= MAX_BENEFIT_ITEMS}
        className="text-xs font-medium text-neutral-800 disabled:opacity-40"
        onClick={() =>
          onChange([...items, { id: `benefit-${items.length + 1}`, title: "", body: "" }])
        }
      >
        + {t("addBenefit")}
      </button>
    </div>
  );
}

/**
 * CUST-H4-5 — real multi-select product picker, replacing the raw
 * product-id text input. Selection/order/dedupe/max all live here as plain
 * array operations on `productIds` (the same presentation-only contract —
 * no price/image/name is ever written back, only ids); display data for
 * the already-selected chips and the candidate list both come from props
 * owned by `ExperienceBuilder` (`selectedProducts` is the same batched
 * `ids[]` resolution that feeds the Canvas preview — no second fetch).
 */
function FeaturedPickerFields({
  productIds,
  t,
  onChange,
  search,
  listState,
  list,
  onSearchChange,
  onRetryList,
  selectedProducts,
  selectedState,
  onRetrySelected,
}: {
  productIds: string[];
  t: (key: CustomizerMessageKey) => string;
  onChange: (productIds: string[]) => void;
  search: string;
  listState: "idle" | "loading" | "error" | "ready";
  list: WorkspaceProductSummary[];
  onSearchChange?: (value: string) => void;
  onRetryList?: () => void;
  selectedProducts: WorkspaceProductSummary[];
  selectedState: "idle" | "loading" | "error" | "ready";
  onRetrySelected?: () => void;
}) {
  const atMax = productIds.length >= MAX_FEATURED_PRODUCTS;
  const byId = new Map(selectedProducts.map((product) => [product.id, product]));

  function toggle(id: string) {
    if (productIds.includes(id)) {
      onChange(productIds.filter((existing) => existing !== id));
      return;
    }
    if (atMax) return;
    onChange([...productIds, id]);
  }

  function move(id: string, delta: number) {
    const index = productIds.indexOf(id);
    if (index < 0) return;
    onChange(moveIndex(productIds, index, delta));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">{t("featuredHint")}</p>

      <div data-featured-selected="">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium text-text">
            {t("featuredSelectedLabel")}
          </p>
          <span className="text-xs text-muted" aria-live="polite">
            {productIds.length}/{MAX_FEATURED_PRODUCTS}
          </span>
        </div>
        {productIds.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted">{t("featuredSelectedEmpty")}</p>
        ) : selectedState === "error" ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-muted">{t("featuredPickerLoadFailed")}</span>
            <button type="button" className="text-xs font-medium text-text" onClick={onRetrySelected}>
              {t("retry")}
            </button>
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {productIds.map((id, index) => {
              const product = byId.get(id);
              return (
                <li
                  key={id}
                  data-featured-selected-item={id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                    {product?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- thumbnail is an untrusted tenant media URL, not a static asset
                      <img src={product.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {selectedState === "loading" || selectedState === "idle" ? (
                      <span className="text-muted">{t("featuredPickerLoading")}</span>
                    ) : (
                      <bdi>{product?.name ?? id}</bdi>
                    )}
                  </span>
                  <span className="flex shrink-0">
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={t("moveUp")}
                      disabled={index === 0}
                      onClick={() => move(id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={t("moveDown")}
                      disabled={index === productIds.length - 1}
                      onClick={() => move(id, 1)}
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-muted"
                    onClick={() => onChange(productIds.filter((existing) => existing !== id))}
                  >
                    {t("removeItem")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {atMax ? <p className="mt-1.5 text-xs text-muted">{t("featuredMaxReachedHint")}</p> : null}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <label className="sr-only" htmlFor="featured-picker-search">
          {t("featuredPickerSearchLabel")}
        </label>
        <input
          id="featured-picker-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder={t("featuredPickerSearchPlaceholder")}
          className={inputClass}
        />
        <div
          role="listbox"
          aria-label={t("featuredPickerResultsLabel")}
          aria-multiselectable="true"
          className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
        >
          {listState === "loading" || listState === "idle" ? (
            <p data-featured-picker-loading="" className="px-2 py-3 text-center text-xs text-muted">
              {t("featuredPickerLoading")}
            </p>
          ) : listState === "error" ? (
            <div data-featured-picker-error="" className="flex flex-col items-center gap-2 px-2 py-3 text-center text-xs text-muted">
              <span>{t("featuredPickerLoadFailed")}</span>
              <button
                type="button"
                onClick={onRetryList}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text"
              >
                {t("retry")}
              </button>
            </div>
          ) : list.length === 0 ? (
            <p data-featured-picker-empty="" className="px-2 py-3 text-center text-xs text-muted">
              {t("featuredPickerEmpty")}
            </p>
          ) : (
            list.map((product) => {
              const selected = productIds.includes(product.id);
              const disabled = !selected && atMax;
              return (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  data-featured-option={product.id}
                  onClick={() => toggle(product.id)}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm disabled:opacity-40 ${
                    selected ? "bg-primary-soft font-medium text-primary" : "text-text hover:bg-primary-soft"
                  }`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                    {product.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- thumbnail is an untrusted tenant media URL, not a static asset
                      <img src={product.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <bdi>{product.name}</bdi>
                  </span>
                  {selected ? <span aria-hidden="true">✓</span> : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CUST-H4-7 — real multi-select Offers picker. Same selection model as
 * `FeaturedPickerFields` (ordered id array: toggle/dedupe/max/reorder/remove)
 * but over the *configured Offers* list rather than a product search: the
 * workspace Offers read returns every candidate (≤12) with its live/hidden
 * evaluation, so there is nothing to search and no request per offer.
 *
 * Only `offerIds` is ever written back. Prices, discount, status and names
 * are display-only values the server computed (`WorkspaceOffer`); nothing
 * here derives or edits them, and the raw offer id is never rendered.
 *
 * A selected id that is hidden stays in the draft (scheduled offers can be
 * pre-selected) and is shown honestly with its reason; one that no longer
 * exists at all is shown as "no longer available" and stays removable — it is
 * never silently dropped and never faked into a card.
 */
function OffersPickerFields({
  offerIds,
  t,
  locale,
  onChange,
  offers,
  state,
  onRetry,
  management,
}: {
  offerIds: string[];
  t: (key: CustomizerMessageKey) => string;
  locale: CustomizerLocale;
  onChange: (offerIds: string[]) => void;
  offers: WorkspaceOffer[];
  state: "idle" | "loading" | "error" | "ready";
  onRetry?: () => void;
  management?: OfferManagement;
}) {
  const atMax = offerIds.length >= MAX_OFFERS;
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const pending = state === "idle" || state === "loading";

  function toggle(id: string) {
    if (offerIds.includes(id)) {
      onChange(offerIds.filter((existing) => existing !== id));
      return;
    }
    if (atMax) return;
    onChange([...offerIds, id]);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">{t("offersHint")}</p>

      <div data-offers-selected="">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium text-text">{t("offersSelectedLabel")}</p>
          <span className="text-xs text-muted" aria-live="polite">
            {offerIds.length}/{MAX_OFFERS}
          </span>
        </div>
        {offerIds.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted">{t("offersSelectedEmpty")}</p>
        ) : state === "error" ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-muted">{t("offersLoadFailed")}</span>
            <button type="button" className="text-xs font-medium text-text" onClick={onRetry}>
              {t("retry")}
            </button>
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {offerIds.map((id, index) => {
              const offer = byId.get(id);
              const missing = !pending && offer === undefined;
              // Accessible names carry the product's name so "move up" /
              // "remove" are unambiguous per row (never the raw offer id).
              const rowName = (offer && offerDisplayName(offer, locale)) ?? t("offersUnavailable");
              return (
                <li
                  key={id}
                  data-offers-selected-item={id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <OfferThumb offer={offer} />
                  {pending ? (
                    <span className="min-w-0 flex-1 text-sm text-muted">{t("offersLoading")}</span>
                  ) : missing ? (
                    <span data-offers-unavailable="" className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{t("offersUnavailable")}</span>
                      <span className="text-xs text-muted">{t("offersUnavailableHint")}</span>
                    </span>
                  ) : offer ? (
                    <OfferSummary offer={offer} t={t} locale={locale} />
                  ) : null}
                  <span className="flex shrink-0">
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={`${t("offersMoveUp")}: ${rowName}`}
                      disabled={index === 0}
                      onClick={() => onChange(moveIndex(offerIds, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={`${t("offersMoveDown")}: ${rowName}`}
                      disabled={index === offerIds.length - 1}
                      onClick={() => onChange(moveIndex(offerIds, index, 1))}
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-muted"
                    aria-label={`${t("offersRemove")}: ${rowName}`}
                    onClick={() => onChange(offerIds.filter((existing) => existing !== id))}
                  >
                    {t("removeItem")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {atMax ? <p className="mt-1.5 text-xs text-muted">{t("offersMaxReachedHint")}</p> : null}
      </div>

      <OfferCatalog
        offers={offers}
        state={state}
        onRetry={onRetry}
        selectedIds={offerIds}
        atMaxSelected={atMax}
        onToggle={toggle}
        locale={locale}
        t={t}
        management={management}
      />
    </div>
  );
}

/**
 * Deferred local draft for inputs whose parent commit immediately
 * normalizes the whole config (`ExperienceBuilder.updateDraft` →
 * `normalizePresentationConfig`).
 *
 * App Store / Google Play URLs are replaced with `""` until they are a
 * complete allow-listed URL, so writing every keystroke into `config.apps`
 * clears the field. Banner `imageAlt` is trimmed (and code-point truncated)
 * on every commit, so a trailing space between words such as `Summer sale`
 * disappears before the next character is typed.
 *
 * The raw draft stays local while the field is focused or being typed.
 * Normalization runs only at the blur/commit boundary, through the same
 * `onCommit` → `patch` path every other field already uses — no second
 * persistence model. After editing stops, the draft resyncs to the
 * authoritative `value` even when that string did not change (an invalid
 * URL rejected back to the existing `""`, or whitespace-only alt text
 * trimmed to `""`). External `value` updates apply only while the field
 * is not being edited, so a parent refresh cannot clobber in-progress text.
 * `draftRef` is what gets committed, not the `draft` state closed over by
 * `onBlur`, so a blur in the same turn as the last keystroke cannot drop
 * the character that has not re-rendered yet.
 */
export function DeferredCommitField({
  label,
  hint,
  placeholder,
  value,
  dir,
  onCommit,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  /** Pin the text direction (URLs are always left-to-right). */
  dir?: "ltr";
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const draftRef = useRef(value);
  useEffect(() => {
    if (!isEditing) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [value, isEditing]);
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputClass}
        value={draft}
        placeholder={placeholder}
        dir={dir}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setIsEditing(true);
          setDraft(event.target.value);
        }}
        onBlur={() => {
          const next = draftRef.current;
          setIsEditing(false);
          onCommit(next);
        }}
      />
    </Field>
  );
}

// CUST-H4-4 — same config.apps fields/validators the standalone AppsPanel
// already edits (AppsPanel stays, for merchants who land there first via
// "التطبيقات"/Applications settings). Editing here keeps `setVisible`'s
// existing showHomepageSection sync intact — this panel never touches
// `visible` or `showHomepageSection` itself, only the content fields and
// the separate footer-placement toggle.
function AppPromoFields({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-500">{t("appsHint")}</p>
      <Field label={t("appName")}>
        <input
          className={inputClass}
          value={config.apps.appName}
          onChange={(event) =>
            patch({ apps: { ...config.apps, appName: event.target.value } })
          }
        />
      </Field>
      <DeferredCommitField
        label={t("iosUrl")}
        placeholder="https://apps.apple.com/..."
        value={config.apps.iosUrl}
        onCommit={(iosUrl) => patch({ apps: { ...config.apps, iosUrl } })}
      />
      <DeferredCommitField
        label={t("androidUrl")}
        placeholder="https://play.google.com/..."
        value={config.apps.androidUrl}
        onCommit={(androidUrl) => patch({ apps: { ...config.apps, androidUrl } })}
      />
      <Toggle
        compact
        label={t("showAppFooter")}
        checked={config.apps.showFooterLinks}
        onChange={(showFooterLinks) =>
          patch({ apps: { ...config.apps, showFooterLinks } })
        }
      />
    </div>
  );
}

function PagesPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-5 text-neutral-500">{t("pagesHint")}</p>
      <ul className="border border-neutral-200">
        {config.pages.map((page, index) => (
          <li
            key={page.id}
            className="space-y-2 border-b border-neutral-200 p-3 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-neutral-900">
                {t(PAGE_LABEL[page.slug])}
              </span>
              <span className="text-[11px] text-neutral-400">
                {t("gatedBadge")}
              </span>
            </div>
            <input
              className={inputClass}
              value={page.title}
              placeholder={t(PAGE_LABEL[page.slug])}
              onChange={(event) => {
                const pages = config.pages.map((item, i) =>
                  i === index ? { ...item, title: event.target.value } : item,
                );
                patch({ pages });
              }}
            />
            <Toggle
              compact
              label={t("pageEnabled")}
              checked={page.enabled}
              onChange={(enabled) => {
                const pages = config.pages.map((item, i) =>
                  i === index ? { ...item, enabled } : item,
                );
                patch({ pages });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  compact = false,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 ${
        compact ? "min-h-8 shrink-0" : "min-h-11 justify-between gap-3"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={
          compact
            ? "text-[11px] text-neutral-600"
            : "text-[13px] text-neutral-800"
        }
      >
        {label}
      </span>
      <span className="relative inline-flex h-6 w-11 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface" />
        <span className="absolute top-0.5 start-0.5 size-5 rounded-full bg-surface shadow-sm transition-[inset-inline-start] peer-checked:start-[22px]" />
      </span>
    </label>
  );
}
