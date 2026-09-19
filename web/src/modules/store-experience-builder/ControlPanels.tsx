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
} from "./presentation";
import { buildWhatsAppUrl } from "./presentation/urls";
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

export const CUSTOMIZER_NAV_GROUPS: Array<{
  items: Array<{ id: CustomizerPanel; label: CustomizerMessageKey }>;
}> = [
  {
    items: [
      { id: "theme", label: "theme" },
      { id: "branding", label: "branding" },
    ],
  },
  {
    items: [
      { id: "header", label: "header" },
      { id: "homepage", label: "homepage" },
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
  selectedSection?: HomeBuilderSectionKey | null;
  onSelectSection?: (key: HomeBuilderSectionKey) => void;
}

export function ControlPanels({
  panel,
  config,
  locale,
  liveStoreName,
  onChange,
  selectedSection = null,
  onSelectSection,
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
      return (
        <HomepagePanel
          config={config}
          t={t}
          patch={patch}
          selectedSection={selectedSection}
          onSelectSection={onSelectSection}
        />
      );
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

function Section({
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

function Segmented<T extends string>({
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
          onClick={() => onChange(option.id)}
          className={`h-9 flex-1 px-2 text-[12px] font-medium ${
            value === option.id
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const inputClass =
  "h-10 w-full border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-800";
const selectClass = inputClass;
const btnClass =
  "inline-flex h-8 items-center border border-neutral-300 bg-white px-2.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50";
const iconBtnClass =
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
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const contrast = contrastRatio(config.primaryColor, "#ffffff");
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
                onClick={() =>
                  patch({
                    themePreset: preset.id,
                    primaryColor: preset.primary,
                  })
                }
                className={`overflow-hidden border text-start ${
                  selected
                    ? "border-neutral-900"
                    : "border-neutral-200 hover:border-neutral-400"
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
              value={config.primaryColor}
              onChange={(event) =>
                patch({
                  primaryColor: event.target.value,
                  themePreset: matchPreset(event.target.value),
                })
              }
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            className={`${inputClass} font-mono uppercase tracking-wide`}
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
      <div className="space-y-5">
        <Field label={t("font")}>
          <select className={selectClass} value={config.fontPreset} disabled>
            <option value="cairo-geist">{t("fontCairoGeist")}</option>
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
      </div>
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
    <div className="space-y-6">
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
      <span className="block text-[12px] font-medium text-neutral-600">
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
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
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
    </div>
  );
}

function HomepagePanel({
  config,
  t,
  patch,
  selectedSection = null,
  onSelectSection,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
  selectedSection?: HomeBuilderSectionKey | null;
  onSelectSection?: (key: HomeBuilderSectionKey) => void;
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
    <div className="space-y-7">
      <Section title={t("heroContent")}>
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
      </Section>
      <Section title={t("composerTitle")} hint={t("composerHint")}>
        <ul className="border border-neutral-200">
          {config.homepage.sections.map((section, index) => {
            const isSelected = selectedSection === section.type;
            return (
            <li
              key={section.id}
              data-composer-section={section.type}
              className={`flex h-12 items-center gap-1 border-b border-neutral-200 px-1 last:border-b-0 ${
                isSelected
                  ? "border-s-2 border-s-neutral-900 bg-neutral-50 ps-0.5"
                  : ""
              }`}
            >
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
                  disabled={index === config.homepage.sections.length - 1}
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
                title={t(SECTION_LABEL[section.type])}
                onClick={() => onSelectSection?.(section.type)}
                className="min-w-0 flex-1 rounded-sm px-1 py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                <p
                  className={`truncate text-[13px] text-neutral-900 ${
                    isSelected ? "font-semibold" : "font-medium"
                  }`}
                >
                  {t(SECTION_LABEL[section.type])}
                </p>
                {isGatedHomeSection(section.type) ? (
                  <p className="text-[10px] leading-none text-neutral-400">
                    {t("gatedBadge")}
                  </p>
                ) : null}
              </button>
              <Toggle
                compact
                label={
                  section.visible ? t("sectionVisible") : t("sectionHidden")
                }
                checked={section.visible}
                onChange={(visible) => {
                  const sections = config.homepage.sections.map((item, i) =>
                    i === index ? { ...item, visible } : item,
                  );
                  patch({ homepage: { ...config.homepage, sections } });
                }}
              />
            </li>
            );
          })}
        </ul>
      </Section>
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
              <div className="flex items-center gap-1">
                <Toggle
                  compact
                  label={t("sectionVisible")}
                  checked={item.enabled}
                  onChange={(enabled) => {
                    const social = config.social.map((row, i) =>
                      i === index ? { ...row, enabled } : item,
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
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  return (
    <div className="space-y-6">
      <Section hint={t("verificationIntro")}>
        <div className="border border-neutral-200 px-3 py-3">
          <p className="text-[12px] font-medium text-neutral-500">
            {t("awjVerified")}
          </p>
          <p className="mt-1 text-[15px] font-semibold text-neutral-900">
            {t("notVerified")}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-neutral-500">
            {t("verificationWarning")}
          </p>
        </div>
      </Section>
      <Section title={t("merchantProvided")}>
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
      </Section>
      <div className="border-y border-neutral-200">
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
              patch({
                apps: { ...config.apps, androidUrl: event.target.value },
              })
            }
          />
        </Field>
      </Section>
      <Section title={t("appsPlacement")}>
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
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
      </Section>
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

function Toggle({
  label,
  checked,
  onChange,
  compact = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 ${
        compact ? "min-h-8 shrink-0" : "min-h-11 justify-between gap-3"
      }`}
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
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 bg-neutral-300 peer-checked:bg-neutral-900 peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400" />
        <span className="absolute top-0.5 start-0.5 size-4 bg-white transition-[inset-inline-start] peer-checked:start-[18px]" />
      </span>
    </label>
  );
}
