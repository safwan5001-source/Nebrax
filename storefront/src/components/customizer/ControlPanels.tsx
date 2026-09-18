"use client";

import type { ReactNode } from "react";
import {
  type CONTENT_PAGE_SLUGS,
  contrastRatio,
  DENSITY_PRESETS,
  type HomeBuilderSectionKey,
  isGatedHomeSection,
  PRODUCT_CARD_PRESETS,
  RADIUS_PRESETS,
  SOCIAL_NETWORKS,
  type SocialNetwork,
  type StorefrontPresentationConfig,
  THEME_PRESETS,
  type ThemePresetId,
} from "@/lib/presentation";
import { buildWhatsAppUrl } from "@/lib/presentation/urls";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";

export type CustomizerPanel =
  | "theme"
  | "branding"
  | "header"
  | "homepage"
  | "footer"
  | "contact"
  | "whatsapp"
  | "social"
  | "verification"
  | "apps"
  | "pages";

export const CUSTOMIZER_PANELS: Array<{
  id: CustomizerPanel;
  label: CustomizerMessageKey;
}> = [
  { id: "theme", label: "theme" },
  { id: "branding", label: "branding" },
  { id: "header", label: "header" },
  { id: "homepage", label: "homepage" },
  { id: "footer", label: "footer" },
  { id: "contact", label: "contact" },
  { id: "whatsapp", label: "whatsapp" },
  { id: "social", label: "social" },
  { id: "verification", label: "verification" },
  { id: "apps", label: "apps" },
  { id: "pages", label: "pages" },
];

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

const SECTION_LABEL: Record<HomeBuilderSectionKey, CustomizerMessageKey> = {
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

interface PanelsProps {
  panel: CustomizerPanel;
  config: StorefrontPresentationConfig;
  locale: CustomizerLocale;
  liveStoreName: string | null;
  onChange: (next: StorefrontPresentationConfig) => void;
}

export function ControlPanels({
  panel,
  config,
  locale,
  liveStoreName,
  onChange,
}: PanelsProps) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const patch = (partial: Partial<StorefrontPresentationConfig>) =>
    onChange({ ...config, ...partial });

  switch (panel) {
    case "theme":
      return <ThemePanel config={config} t={t} patch={patch} />;
    case "branding":
      return (
        <BrandingPanel
          config={config}
          t={t}
          liveStoreName={liveStoreName}
          patch={patch}
        />
      );
    case "header":
      return <HeaderPanel config={config} t={t} patch={patch} />;
    case "homepage":
      return <HomepagePanel config={config} t={t} patch={patch} />;
    case "footer":
      return <FooterPanel config={config} t={t} patch={patch} />;
    case "contact":
      return <ContactPanel config={config} t={t} patch={patch} />;
    case "whatsapp":
      return <WhatsAppPanel config={config} t={t} patch={patch} />;
    case "social":
      return <SocialPanel config={config} t={t} patch={patch} />;
    case "verification":
      return <VerificationPanel config={config} t={t} patch={patch} />;
    case "apps":
      return <AppsPanel config={config} t={t} patch={patch} />;
    case "pages":
      return <PagesPanel config={config} t={t} patch={patch} />;
    default:
      return null;
  }
}

function Field({
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
      <span className="block text-[13px] font-medium text-neutral-800">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-xs leading-5 text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-800";
const selectClass = inputClass;
const btnClass =
  "inline-flex h-8 items-center rounded border border-neutral-300 bg-white px-2.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50";

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
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const contrast = contrastRatio(config.primaryColor, "#ffffff");
  return (
    <div className="space-y-5">
      <Field label={t("preset")}>
        <div className="grid grid-cols-1 gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                patch({
                  themePreset: preset.id,
                  primaryColor: preset.primary,
                })
              }
              className={`flex h-10 items-center gap-2 rounded border px-2.5 text-start text-sm ${
                config.themePreset === preset.id
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-neutral-200 hover:border-neutral-400"
              }`}
            >
              <span
                className="size-4 shrink-0 rounded-sm border border-black/10"
                style={{ background: preset.primary }}
              />
              {t(preset.labelKey as CustomizerMessageKey)}
            </button>
          ))}
        </div>
      </Field>
      <Field
        label={t("primaryColor")}
        hint={contrast >= 4.5 ? t("contrastOk") : t("contrastWarn")}
      >
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.primaryColor}
            onChange={(event) =>
              patch({
                primaryColor: event.target.value,
                themePreset: matchPreset(event.target.value),
              })
            }
            className="h-9 w-12 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
          />
          <input
            className={inputClass}
            value={config.primaryColor}
            onChange={(event) =>
              patch({
                primaryColor: event.target.value,
                themePreset: matchPreset(event.target.value),
              })
            }
          />
        </div>
      </Field>
      <Field label={t("font")}>
        <select className={selectClass} value={config.fontPreset} disabled>
          <option value="cairo-geist">{t("fontCairoGeist")}</option>
        </select>
      </Field>
      <Field label={t("density")}>
        <select
          className={selectClass}
          value={config.density}
          onChange={(event) =>
            patch({
              density: event.target.value as (typeof DENSITY_PRESETS)[number],
            })
          }
        >
          {DENSITY_PRESETS.map((id) => (
            <option key={id} value={id}>
              {id === "comfortable"
                ? t("densityComfortable")
                : t("densityCompact")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("radius")}>
        <select
          className={selectClass}
          value={config.radius}
          onChange={(event) =>
            patch({
              radius: event.target
                .value as (typeof RADIUS_PRESETS)[number]["id"],
            })
          }
        >
          {RADIUS_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.id === "default"
                ? t("radiusDefault")
                : preset.id === "subtle"
                  ? t("radiusSubtle")
                  : t("radiusSharp")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("productCard")}>
        <select
          className={selectClass}
          value={config.productCard}
          onChange={(event) =>
            patch({
              productCard: event.target
                .value as (typeof PRODUCT_CARD_PRESETS)[number],
            })
          }
        >
          {PRODUCT_CARD_PRESETS.map((id) => (
            <option key={id} value={id}>
              {id === "standard"
                ? t("productCardStandard")
                : t("productCardCompact")}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function matchPreset(hex: string): ThemePresetId {
  return (
    THEME_PRESETS.find((preset) => preset.primary === hex.toLowerCase())?.id ??
    "awj-modern"
  );
}

function BrandingPanel({
  config,
  t,
  liveStoreName,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  liveStoreName: string | null;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-5">
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
        <p className="text-xs text-neutral-500">
          {t("liveName")}: {liveStoreName}
        </p>
      ) : null}
      <LogoField
        label={t("logo")}
        hint={t("logoHint")}
        value={config.branding.logoDataUrl}
        t={t}
        onChange={(logoDataUrl) =>
          patch({ branding: { ...config.branding, logoDataUrl } })
        }
      />
      <LogoField
        label={t("compactLogo")}
        value={config.branding.compactLogoDataUrl}
        t={t}
        onChange={(compactLogoDataUrl) =>
          patch({ branding: { ...config.branding, compactLogoDataUrl } })
        }
      />
      <LogoField
        label={t("favicon")}
        value={config.branding.faviconDataUrl}
        t={t}
        onChange={(faviconDataUrl) =>
          patch({ branding: { ...config.branding, faviconDataUrl } })
        }
      />
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
  return (
    <div className="space-y-1.5">
      <span className="block text-[13px] font-medium text-neutral-800">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <label className={btnClass}>
          {t("uploadLogo")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
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
            onClick={() => onChange(null)}
          >
            {t("clearLogo")}
          </button>
        ) : (
          <span className="text-xs text-neutral-500">{t("noLogo")}</span>
        )}
      </div>
      {hint ? (
        <p className="text-xs leading-5 text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

function HeaderPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label={t("headerStyle")}>
        <select
          className={selectClass}
          value={config.header.style}
          onChange={(event) =>
            patch({
              header: {
                ...config.header,
                style: event.target.value as "standard" | "compact",
              },
            })
          }
        >
          <option value="standard">{t("headerStandard")}</option>
          <option value="compact">{t("headerCompact")}</option>
        </select>
      </Field>
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
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-neutral-800">
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
        <ul className="space-y-2">
          {config.header.links.map((link, index) => (
            <li
              key={link.id}
              className="rounded border border-neutral-200 p-2 space-y-2"
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
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder={t("linkHref")}
                  value={link.href}
                  onChange={(event) => {
                    const links = config.header.links.map((item, i) =>
                      i === index
                        ? { ...item, href: event.target.value }
                        : item,
                    );
                    patch({ header: { ...config.header, links } });
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={link.enabled}
                    onChange={(event) => {
                      const links = config.header.links.map((item, i) =>
                        i === index
                          ? { ...item, enabled: event.target.checked }
                          : item,
                      );
                      patch({ header: { ...config.header, links } });
                    }}
                  />
                  {t("sectionVisible")}
                </label>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() =>
                    patch({
                      header: {
                        ...config.header,
                        links: moveIndex(config.header.links, index, -1),
                      },
                    })
                  }
                >
                  {t("moveUp")}
                </button>
                <button
                  type="button"
                  className={btnClass}
                  onClick={() =>
                    patch({
                      header: {
                        ...config.header,
                        links: moveIndex(config.header.links, index, 1),
                      },
                    })
                  }
                >
                  {t("moveDown")}
                </button>
                <button
                  type="button"
                  className={btnClass}
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
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HomepagePanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const move = (index: number, delta: number) => {
    const next = [...config.homepage.sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    patch({ homepage: { ...config.homepage, sections: next } });
  };

  return (
    <div className="space-y-5">
      <Field label={t("heroHeadline")}>
        <input
          className={inputClass}
          value={config.homepage.heroHeadline}
          onChange={(event) =>
            patch({
              homepage: {
                ...config.homepage,
                heroHeadline: event.target.value,
              },
            })
          }
        />
      </Field>
      <Field label={t("heroSubheadline")}>
        <input
          className={inputClass}
          value={config.homepage.heroSubheadline}
          onChange={(event) =>
            patch({
              homepage: {
                ...config.homepage,
                heroSubheadline: event.target.value,
              },
            })
          }
        />
      </Field>
      <ul className="space-y-2">
        {config.homepage.sections.map((section, index) => (
          <li
            key={section.key}
            className="rounded border border-neutral-200 bg-white p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-neutral-900">
                {t(SECTION_LABEL[section.key])}
              </span>
              {isGatedHomeSection(section.key) ? (
                <span className="text-[11px] text-neutral-500">
                  {t("gatedBadge")}
                </span>
              ) : null}
              <button
                type="button"
                className={btnClass}
                onClick={() => move(index, -1)}
              >
                {t("moveUp")}
              </button>
              <button
                type="button"
                className={btnClass}
                onClick={() => move(index, 1)}
              >
                {t("moveDown")}
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={section.visible}
                onChange={(event) => {
                  const sections = config.homepage.sections.map((item, i) =>
                    i === index
                      ? { ...item, visible: event.target.checked }
                      : item,
                  );
                  patch({ homepage: { ...config.homepage, sections } });
                }}
              />
              {section.visible ? t("sectionVisible") : t("sectionHidden")}
            </label>
            {isGatedHomeSection(section.key) ? (
              <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                {t("gatedSection")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <Toggle
        label={t("showFooterLogo")}
        checked={config.footer.showLogo}
        onChange={(showLogo) =>
          patch({ footer: { ...config.footer, showLogo } })
        }
      />
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
    <div className="space-y-5">
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
    <div className="space-y-5">
      <Toggle
        label={t("whatsappEnable")}
        checked={config.whatsapp.enabled}
        onChange={(enabled) =>
          patch({ whatsapp: { ...config.whatsapp, enabled } })
        }
      />
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
      <Field label={t("whatsappPlacement")}>
        <select
          className={selectClass}
          value={config.whatsapp.placement}
          onChange={(event) =>
            patch({
              whatsapp: {
                ...config.whatsapp,
                placement: event.target
                  .value as StorefrontPresentationConfig["whatsapp"]["placement"],
              },
            })
          }
        >
          <option value="floating">{t("placementFloating")}</option>
          <option value="footer">{t("placementFooter")}</option>
          <option value="both">{t("placementBoth")}</option>
        </select>
      </Field>
      <p className="text-xs leading-5 text-neutral-500">
        {t("whatsappPreview")}: {href ?? "—"}
      </p>
      <p className="text-xs leading-5 text-neutral-500">
        {t("whatsappNoSend")}
      </p>
    </div>
  );
}

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
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-neutral-800">
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
        <p className="text-xs text-neutral-500">{t("noSocial")}</p>
      ) : null}
      <ul className="space-y-2">
        {config.social.map((item, index) => (
          <li
            key={item.id}
            className="space-y-2 rounded border border-neutral-200 p-2"
          >
            <div className="flex gap-2">
              <select
                className={selectClass}
                value={item.network}
                onChange={(event) => {
                  const social = config.social.map((row, i) =>
                    i === index
                      ? { ...row, network: event.target.value as SocialNetwork }
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
                  patch({ social: config.social.filter((_, i) => i !== index) })
                }
              >
                {t("removeLink")}
              </button>
            </div>
            <input
              className={inputClass}
              placeholder="https://"
              value={item.url}
              onChange={(event) => {
                const social = config.social.map((row, i) =>
                  i === index ? { ...row, url: event.target.value } : row,
                );
                patch({ social });
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) => {
                    const social = config.social.map((row, i) =>
                      i === index
                        ? { ...row, enabled: event.target.checked }
                        : row,
                    );
                    patch({ social });
                  }}
                />
                {t("sectionVisible")}
              </label>
              <button
                type="button"
                className={btnClass}
                onClick={() =>
                  patch({ social: moveIndex(config.social, index, -1) })
                }
              >
                {t("moveUp")}
              </button>
              <button
                type="button"
                className={btnClass}
                onClick={() =>
                  patch({ social: moveIndex(config.social, index, 1) })
                }
              >
                {t("moveDown")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerificationPanel({
  config,
  t,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2.5">
        <p className="text-[13px] font-medium text-neutral-900">
          {t("awjVerified")}
        </p>
        <p className="mt-1 text-sm text-neutral-700">{t("notVerified")}</p>
      </div>
      <p className="text-xs leading-5 text-neutral-600">
        {t("verificationWarning")}
      </p>
      <p className="text-[13px] font-medium text-neutral-800">
        {t("merchantProvided")}
      </p>
      <Field label={t("crNumber")}>
        <input
          className={inputClass}
          value={config.verification.crNumber}
          onChange={(event) =>
            patch({
              verification: {
                ...config.verification,
                crNumber: event.target.value,
              },
            })
          }
        />
      </Field>
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
        <input
          className={inputClass}
          value={config.verification.sourceUrl}
          onChange={(event) =>
            patch({
              verification: {
                ...config.verification,
                sourceUrl: event.target.value,
              },
            })
          }
        />
      </Field>
      <Toggle
        label={t("requestedVerified")}
        checked={config.verification.requestedVerifiedLabel}
        onChange={(requestedVerifiedLabel) =>
          patch({
            verification: { ...config.verification, requestedVerifiedLabel },
          })
        }
      />
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
    <div className="space-y-5">
      <p className="text-xs leading-5 text-neutral-500">{t("appsHint")}</p>
      <Field label={t("appName")}>
        <input
          className={inputClass}
          value={config.apps.appName}
          onChange={(event) =>
            patch({ apps: { ...config.apps, appName: event.target.value } })
          }
        />
      </Field>
      <Field label={t("iosUrl")}>
        <input
          className={inputClass}
          value={config.apps.iosUrl}
          placeholder="https://apps.apple.com/..."
          onChange={(event) =>
            patch({ apps: { ...config.apps, iosUrl: event.target.value } })
          }
        />
      </Field>
      <Field label={t("androidUrl")}>
        <input
          className={inputClass}
          value={config.apps.androidUrl}
          placeholder="https://play.google.com/..."
          onChange={(event) =>
            patch({ apps: { ...config.apps, androidUrl: event.target.value } })
          }
        />
      </Field>
      <Toggle
        label={t("showAppHome")}
        checked={config.apps.showHomepageSection}
        onChange={(showHomepageSection) =>
          patch({ apps: { ...config.apps, showHomepageSection } })
        }
      />
      <Toggle
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
      <p className="text-xs leading-5 text-neutral-500">{t("pagesHint")}</p>
      <ul className="space-y-2">
        {config.pages.map((page, index) => (
          <li
            key={page.id}
            className="rounded border border-neutral-200 p-2.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-neutral-900">
                {t(PAGE_LABEL[page.slug])}
              </span>
              <span className="text-[11px] text-neutral-500">
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
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={page.enabled}
                onChange={(event) => {
                  const pages = config.pages.map((item, i) =>
                    i === index
                      ? { ...item, enabled: event.target.checked }
                      : item,
                  );
                  patch({ pages });
                }}
              />
              {t("pageEnabled")}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-3 text-sm text-neutral-800">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
