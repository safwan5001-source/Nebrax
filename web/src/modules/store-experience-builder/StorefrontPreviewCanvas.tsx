"use client";

import { Home, LayoutGrid, MessageCircle, Search, ShoppingBag, User } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { StoreBrand, storeContainerClassName } from "./StoreBrand";
import { categoryAccent } from "./category-accent";
import {
  isGatedHomeSection,
  previewStoreName,
  type StorefrontPresentationConfig,
} from "./presentation/config";
import { presentationCssVars } from "./presentation/tokens";
import {
  bannerContentOf,
  benefitsContentOf,
  customContentOf,
  featuredContentOf,
} from "./presentation/section-content";
import { buildWhatsAppUrl, sanitizeExternalUrl } from "./presentation/urls";
import { cn } from "@/lib/utils";
import {
  customizerMessage,
  type CustomizerLocale,
  type CustomizerMessageKey,
} from "./messages";
import {
  PREVIEW_CATEGORIES,
  PREVIEW_PRODUCTS,
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
};

interface StorefrontPreviewCanvasProps {
  config: StorefrontPresentationConfig;
  locale: CustomizerLocale;
  viewport: "desktop" | "tablet" | "mobile";
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
  | "social";

export function StorefrontPreviewCanvas({
  config,
  locale,
  viewport,
  liveStoreName = null,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  selectedSection = null,
  onSelectSection,
  selectedChrome = null,
  onSelectChrome,
}: StorefrontPreviewCanvasProps) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const storeName = previewStoreName(
    config,
    liveStoreName,
    PREVIEW_STORE_NAME[locale],
  );
  const vars = presentationCssVars(config.primaryColor, config.radius) as CSSProperties;
  const compact = viewport === "mobile" || config.header.style === "compact";
  const logo =
    compact && config.branding.compactLogoDataUrl
      ? config.branding.compactLogoDataUrl
      : config.branding.logoDataUrl;
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
  const enabledSocial = config.social.flatMap((item) => {
    if (!item.enabled) return [];
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
  const ios = sanitizeExternalUrl(config.apps.iosUrl);
  const android = sanitizeExternalUrl(config.apps.androidUrl);
  const hasApps = Boolean(ios || android);
  const visiblePages = config.pages.filter((page) => page.enabled);
  const legalName = businessIdentity.legal_name?.trim() || null;
  const crNumber = businessIdentity.cr_number?.trim() || null;
  const vatNumber = businessIdentity.vat_number?.trim() || null;
  const hasBusinessIdentity = Boolean(legalName || crNumber || vatNumber);

  return (
    <div
      data-preview-canvas=""
      data-preview-viewport={viewport}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="awj-store-preview relative min-h-full bg-store-background text-store-foreground"
      style={{
        ...vars,
        fontFamily: '"Cairo", "Geist", sans-serif',
      }}
    >
      <p className="sr-only">{t("fixtureCatalogHint")}</p>

      <header
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
              compact
                ? "grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2"
                : "flex items-center gap-6 py-3",
            )}
          >
            {compact && (
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
                "inline-flex",
                onSelectChrome && "awj-preview-section",
                selectedChrome === "branding" && "awj-preview-section-selected",
                compact && "justify-self-center",
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
            {config.header.showSearch && !compact && (
              <div className="flex min-h-10 flex-1 items-center gap-2 rounded-store border border-store-border bg-store-surface px-3 text-sm text-store-muted-foreground">
                <Search className="size-4" aria-hidden />
                {t("search")}
              </div>
            )}
            <div className={cn("flex items-center gap-1", compact && "justify-self-end")}>
              {config.header.showAccount && !compact && (
                <span className="inline-flex size-9 items-center justify-center text-store-foreground">
                  <User className="size-5" aria-hidden />
                  <span className="sr-only">{t("account")}</span>
                </span>
              )}
              {config.header.showCart && (
                <span className="inline-flex h-9 items-center gap-1.5 rounded-store px-2 text-sm font-medium text-store-foreground">
                  <ShoppingBag className="size-5" aria-hidden />
                  {!compact && t("cart")}
                </span>
              )}
            </div>
            {config.header.showSearch && compact && (
              <div className="col-span-3 flex min-h-9 items-center gap-2 rounded-store border border-store-border px-3 text-xs text-store-muted-foreground">
                <Search className="size-3.5" aria-hidden />
                {t("search")}
              </div>
            )}
          </div>
        </div>

        {(config.header.showCategoryNav || extraNav.length > 0) && !compact && (
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
                  <div className="max-w-2xl p-5 md:p-10">
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
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {PREVIEW_CATEGORIES.map((category) => {
                      const accent = categoryAccent(category.color);
                      return (
                        <li key={category.id}>
                          <div
                            className="flex h-full flex-col justify-center gap-0.5 rounded-store border border-store-border border-s-[3px] bg-store-surface px-4 py-3.5"
                            style={{ borderInlineStartColor: accent.rule }}
                          >
                            <span className="line-clamp-2 text-sm font-bold leading-snug text-store-foreground">
                              {category.name[locale]}
                            </span>
                            {category.childCount > 0 && (
                              <span className="text-xs text-store-muted-foreground tabular-nums">
                                {category.childCount}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            }

            if (section.type === "newArrivals") {
              return (
                <section key="newArrivals" aria-labelledby="preview-arrivals">
                  <SectionRule title={t("newArrivals")} action={t("viewAll")} />
                  <ul
                    className={cn(
                      "mt-4 grid gap-3",
                      compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                    )}
                  >
                    {PREVIEW_PRODUCTS.map((product) => (
                      <li
                        key={product.id}
                        className="overflow-hidden rounded-store border border-store-border bg-store-surface"
                      >
                        <div className="aspect-square bg-store-surface-muted" />
                        <div className={cardPad}>
                          <p className="text-[11px] text-store-muted-foreground">
                            {product.category[locale]}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-store-foreground">
                            {product.name[locale]}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
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
              return (
                <section key={section.id} className="rounded-store bg-store-surface px-5 py-6">
                  {empty ? (
                    <p className="text-sm text-store-muted-foreground">{t("sectionBanner")}</p>
                  ) : (
                    <>
                      {banner.imageUrl ? (
                        <img src={banner.imageUrl} alt="" className="mb-3 h-28 w-full rounded-store object-cover" />
                      ) : null}
                      {banner.title ? (
                        <h2 className="text-lg font-extrabold text-store-foreground">{banner.title}</h2>
                      ) : null}
                      {banner.subtitle ? (
                        <p className="mt-1 text-sm text-store-muted-foreground">{banner.subtitle}</p>
                      ) : null}
                      {banner.ctaLabel ? (
                        <span className="mt-3 inline-flex h-9 items-center rounded-store bg-store-primary px-3 text-xs font-bold text-store-primary-foreground">
                          {banner.ctaLabel}
                        </span>
                      ) : null}
                    </>
                  )}
                </section>
              );
            }

            if (section.type === "benefits") {
              const items = benefitsContentOf(section).items.filter((item) => item.title || item.body);
              return (
                <section key={section.id}>
                  <h2 className="text-base font-extrabold">{t("sectionBenefits")}</h2>
                  {items.length === 0 ? (
                    <p className="mt-2 text-sm text-store-muted-foreground">{t("sectionBenefits")}</p>
                  ) : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {items.map((item) => (
                        <li key={item.id} className="rounded-store border border-store-border px-3 py-3">
                          {item.title ? <p className="text-sm font-bold">{item.title}</p> : null}
                          {item.body ? <p className="text-sm text-store-muted-foreground">{item.body}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            }

            if (section.type === "customContent") {
              const blocks = customContentOf(section).blocks.filter((block) => block.text.trim());
              return (
                <section key={section.id} className="space-y-2">
                  {blocks.length === 0 ? (
                    <p className="text-sm text-store-muted-foreground">{t("sectionCustomContent")}</p>
                  ) : (
                    blocks.map((block) =>
                      block.kind === "heading" ? (
                        <h2 key={block.id} className="text-lg font-extrabold">{block.text}</h2>
                      ) : (
                        <p key={block.id} className="text-sm text-store-muted-foreground">{block.text}</p>
                      ),
                    )
                  )}
                </section>
              );
            }

            if (section.type === "featured") {
              const ids = featuredContentOf(section).productIds.filter((id) => id);
              return (
                <section key={section.id}>
                  <h2 className="text-base font-extrabold">{t("sectionFeatured")}</h2>
                  <p className="mt-1 text-xs text-store-muted-foreground">{t("featuredHint")}</p>
                  {ids.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {ids.map((id) => (
                        <li key={id} className="rounded-store border border-store-border px-2 py-1 text-xs">
                          {id}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    {ios ? <span className="rounded-store bg-white px-3 py-2 text-store-foreground">App Store</span> : null}
                    {android ? <span className="rounded-store bg-white px-3 py-2 text-store-foreground">Google Play</span> : null}
                  </div>
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
                {content}
              </SelectablePreviewSection>
            );
          })}
      </div>

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
              className="inline-flex"
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
            <p className="mt-3 max-w-lg text-sm text-store-footer-muted">
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
              {footerWhatsapp ? (
                <a
                  href={footerWhatsapp}
                  data-preview-chrome="whatsapp"
                  className="text-store-footer-link underline-offset-2 hover:underline"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectChrome?.("whatsapp");
                  }}
                >
                  {t("whatsapp")}
                </a>
              ) : null}
            </FooterCol>
            <FooterCol title={t("policies")}>
              {visiblePages.length
                ? visiblePages.map((page) => (
                    <span key={page.id}>
                      {page.title.trim() || t(pageTitleKey(page.slug))}
                    </span>
                  ))
                : <span>{t("pagesHint")}</span>}
              {hasApps && config.apps.showFooterLinks ? (
                <>
                  {ios ? <span>App Store</span> : null}
                  {android ? <span>Google Play</span> : null}
                </>
              ) : null}
            </FooterCol>
          </div>
          {(config.contact.phone ||
            config.contact.email ||
            config.contact.address ||
            config.contact.hours ||
            enabledSocial.length > 0 ||
            hasBusinessIdentity ||
            config.verification.licenseNumber.trim() ||
            config.sbc.show_in_storefront) && (
            <div className="mt-8 border-t border-store-footer-border pt-6 text-sm text-store-footer-muted">
              {config.contact.phone ? <p>{config.contact.phone}</p> : null}
              {config.contact.email ? <p>{config.contact.email}</p> : null}
              {config.contact.address ? <p>{config.contact.address}</p> : null}
              {config.contact.hours ? <p>{config.contact.hours}</p> : null}
              {enabledSocial.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-3">
                  {enabledSocial.map((item) => (
                    <a
                      key={item.id}
                      href={item.href}
                      data-preview-chrome="social"
                      className="text-store-footer-link"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectChrome?.("social");
                      }}
                    >
                      {item.network}
                    </a>
                  ))}
                </p>
              )}
              {hasBusinessIdentity ? (
                <div className="mt-4 space-y-1">
                  <p className="font-medium text-store-footer-link">
                    {t("businessInformation")}
                  </p>
                  {legalName ? (
                    <p>
                      {t("legalName")}: {legalName}
                    </p>
                  ) : null}
                  {crNumber ? (
                    <p>
                      {t("crNumber")}: {crNumber}
                    </p>
                  ) : null}
                  {vatNumber ? (
                    <p>
                      {t("vatNumber")}: {vatNumber}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {config.verification.licenseNumber.trim() ? (
                <div className="mt-4 space-y-1">
                  <p className="font-medium text-store-footer-link">
                    {t("merchantProvided")}
                  </p>
                  {config.verification.licenseNumber.trim() ? (
                    <p>
                      {t("licenseNumber")}: {config.verification.licenseNumber}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {config.sbc.show_in_storefront ? (
                <div className="mt-4 border-t border-store-footer-border pt-4">
                  <p className="font-medium text-store-footer-link">
                    {t("sbcVerified")}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="border-t border-store-footer-border">
          <div className={cn(storeContainerClassName, "py-5")}>
            <p className="text-xs text-store-footer-muted">
              {config.footer.copyright.trim() || `© ${storeName}`}
            </p>
          </div>
        </div>
      </footer>

      {compact && (
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
            "absolute z-30 inline-flex size-12 items-center justify-center rounded-full bg-[#128c7e] text-white",
            onSelectChrome && "awj-preview-section",
            selectedChrome === "whatsapp" && "awj-preview-section-selected",
            compact ? "end-3 bottom-16" : "end-4 bottom-4",
          )}
        >
          <MessageCircle className="size-5" aria-hidden />
        </a>
      )}
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
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:h-5"
        />
        <h2 className="text-base font-extrabold leading-tight text-store-foreground md:text-lg">
          {title}
        </h2>
      </div>
      <span className="text-xs font-bold text-store-primary md:text-sm">{action}</span>
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
