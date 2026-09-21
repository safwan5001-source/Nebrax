import {
  CONTENT_PAGE_SLUGS,
  DENSITY_PRESETS,
  FONT_PRESETS,
  GATED_HOME_SECTION_KEYS,
  HEADER_STYLES,
  HOME_BUILDER_SECTION_KEYS,
  PRODUCT_CARD_PRESETS,
  PRESENTATION_CONFIG_VERSION,
  RADIUS_PRESETS,
  SOCIAL_NETWORKS,
  THEME_PRESETS,
  isSafeHexColor,
  presetPrimary,
  type ContentPageSlug,
  type DensityId,
  type FontPresetId,
  type HeaderStyleId,
  type HomeBuilderSectionKey,
  type ProductCardStyleId,
  type RadiusId,
  type SocialNetwork,
  type ThemePresetId,
} from "./tokens";
import {
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  sanitizeExternalUrl,
  sanitizeLogoUrl,
} from "./urls";
import {
  normalizeOptionalSectionContent,
  type SectionContent,
} from "./section-content";

export type NavLinkKind = "home" | "category" | "product" | "content" | "external";
export type WhatsAppPlacement = "floating" | "footer" | "both";

export interface PresentationNavLink {
  id: string;
  label: string;
  kind: NavLinkKind;
  href: string;
  enabled: boolean;
}

/**
 * Homepage section instance (contract v2). `id` is the stable instance
 * identity — local to this presentation document, never a global resource
 * id. `type` is the closed, fail-closed section type. Legacy v1 documents
 * stored `{key, visible}`; they migrate deterministically to `id = key`.
 */
export interface PresentationHomeSection {
  id: string;
  type: HomeBuilderSectionKey;
  visible: boolean;
  /** Present only when this instance has non-empty authored content. */
  content?: SectionContent;
}

/**
 * Upper bound on homepage section instances. Bounds document size and keeps
 * normalization fail-closed; well above any sane homepage.
 */
export const MAX_HOME_SECTIONS = 30;

export interface PresentationSocialLink {
  id: string;
  network: SocialNetwork;
  url: string;
  enabled: boolean;
}

export interface PresentationContentPage {
  id: string;
  slug: ContentPageSlug;
  title: string;
  enabled: boolean;
}

export interface StorefrontPresentationConfig {
  version: typeof PRESENTATION_CONFIG_VERSION;
  themePreset: ThemePresetId;
  primaryColor: string;
  accentColor: string | null;
  fontPreset: FontPresetId;
  density: DensityId;
  radius: RadiusId;
  productCard: ProductCardStyleId;
  branding: {
    displayName: string;
    logoDataUrl: string | null;
    compactLogoDataUrl: string | null;
    faviconDataUrl: string | null;
  };
  header: {
    style: HeaderStyleId;
    showSearch: boolean;
    showAccount: boolean;
    showCart: boolean;
    showCategoryNav: boolean;
    links: PresentationNavLink[];
  };
  homepage: {
    sections: PresentationHomeSection[];
    heroHeadline: string;
    heroSubheadline: string;
  };
  footer: {
    tagline: string;
    showLogo: boolean;
    copyright: string;
  };
  contact: {
    phone: string;
    email: string;
    address: string;
    hours: string;
  };
  whatsapp: {
    enabled: boolean;
    phone: string;
    message: string;
    placement: WhatsAppPlacement;
  };
  social: PresentationSocialLink[];
  verification: {
    crNumber: string;
    licenseNumber: string;
    sourceUrl: string;
    /**
     * Merchant-requested display. The renderer MUST ignore this for any
     * "Verified" badge. Typing a number does not verify a business.
     */
    requestedVerifiedLabel: boolean;
  };
  sbc: {
    authentication_number: string;
    seal_token: string;
    show_in_storefront: boolean;
  };
  apps: {
    iosUrl: string;
    androidUrl: string;
    appName: string;
    showHomepageSection: boolean;
    showFooterLinks: boolean;
  };
  pages: PresentationContentPage[];
}

const NAV_KINDS: NavLinkKind[] = [
  "home",
  "category",
  "product",
  "content",
  "external",
];
const PLACEMENTS: WhatsAppPlacement[] = ["floating", "footer", "both"];

function inList<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const text = asString(value, fallback).trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(text) ? text : fallback;
}

export const DEFAULT_PRESENTATION_CONFIG: StorefrontPresentationConfig = {
  version: PRESENTATION_CONFIG_VERSION,
  themePreset: "awj-modern",
  primaryColor: "#12372a",
  accentColor: null,
  fontPreset: "cairo-geist",
  density: "comfortable",
  radius: "default",
  productCard: "standard",
  branding: {
    displayName: "",
    logoDataUrl: null,
    compactLogoDataUrl: null,
    faviconDataUrl: null,
  },
  header: {
    style: "standard",
    showSearch: true,
    showAccount: true,
    showCart: true,
    showCategoryNav: true,
    links: [
      { id: "nav-home", label: "", kind: "home", href: "/", enabled: true },
    ],
  },
  homepage: {
    sections: HOME_BUILDER_SECTION_KEYS.map((key) => ({
      id: key,
      type: key,
      visible:
        key === "hero" ||
        key === "categories" ||
        key === "newArrivals" ||
        key === "wholesale",
    })),
    heroHeadline: "",
    heroSubheadline: "",
  },
  footer: {
    tagline: "",
    showLogo: true,
    copyright: "",
  },
  contact: {
    phone: "",
    email: "",
    address: "",
    hours: "",
  },
  whatsapp: {
    enabled: false,
    phone: "",
    message: "",
    placement: "floating",
  },
  social: [],
  verification: {
    crNumber: "",
    licenseNumber: "",
    sourceUrl: "",
    requestedVerifiedLabel: false,
  },
  sbc: {
    authentication_number: "",
    seal_token: "",
    show_in_storefront: false,
  },
  apps: {
    iosUrl: "",
    androidUrl: "",
    appName: "",
    showHomepageSection: false,
    showFooterLinks: false,
  },
  pages: CONTENT_PAGE_SLUGS.map((slug) => ({
    id: `page-${slug}`,
    slug,
    title: "",
    enabled: slug !== "about" && slug !== "contact" && slug !== "faq",
  })),
};

/**
 * Resolves stored homepage sections to safe instances.
 *
 * Input accepts both shapes:
 * - v2 instance entries `{id, type, visible}` — identity is `id`;
 * - legacy v1 entries `{key, visible}` — migrate to `id = key` (deterministic,
 *   stable across reloads/saves; no random ids ever).
 *
 * Unknown types and malformed entries are dropped (fail-closed). Duplicate
 * ids collapse to the first occurrence, deterministically.
 *
 * Missing-section semantics are versioned: `legacy` input (document version
 * < 2, or none) re-appends missing defaults exactly as v1 did, so old
 * documents keep their current meaning. New v2 documents treat absence as a
 * real deletion and are returned as-is.
 */
function resolveHomeBuilderSections(
  configured: unknown,
  legacy: boolean,
): PresentationHomeSection[] {
  if (!Array.isArray(configured) || configured.length === 0) {
    return legacy
      ? DEFAULT_PRESENTATION_CONFIG.homepage.sections.map((section) => ({
          ...section,
        }))
      : [];
  }

  const out: PresentationHomeSection[] = [];
  const seenIds = new Set<string>();
  const seenTypes = new Set<string>();

  for (const raw of configured) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;

    let id: string;
    let type: string;
    if ("id" in entry || "type" in entry) {
      id = safeId(entry.id, "");
      type = asString(entry.type);
      if (!id) continue;
    } else {
      const key = asString(entry.key);
      id = key;
      type = key;
    }
    if (!(HOME_BUILDER_SECTION_KEYS as readonly string[]).includes(type)) {
      continue;
    }
    if (seenIds.has(id)) continue;

    seenIds.add(id);
    seenTypes.add(type);
    const section: PresentationHomeSection = {
      id,
      type: type as HomeBuilderSectionKey,
      visible: asBoolean(entry.visible, false),
    };
    const content = normalizeOptionalSectionContent(type, entry.content);
    if (content) section.content = content;
    out.push(section);
    if (out.length >= MAX_HOME_SECTIONS) break;
  }

  if (legacy) {
    for (const fallback of DEFAULT_PRESENTATION_CONFIG.homepage.sections) {
      if (!seenTypes.has(fallback.type)) out.push({ ...fallback });
    }
  }

  return out;
}

function normalizeNavLink(
  raw: unknown,
  index: number,
): PresentationNavLink | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = inList(value.kind, NAV_KINDS, "home");
  const href =
    kind === "external"
      ? (sanitizeExternalUrl(asString(value.href)) ?? "")
      : asString(value.href, "/").slice(0, 240);
  return {
    id: safeId(value.id, `nav-${index}`),
    label: asString(value.label).slice(0, 80),
    kind,
    href,
    enabled: asBoolean(value.enabled, true),
  };
}

function normalizeSocial(
  raw: unknown,
  index: number,
): PresentationSocialLink | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const network = inList(value.network, SOCIAL_NETWORKS, "instagram");
  return {
    id: safeId(value.id, `social-${index}`),
    network,
    url: sanitizeExternalUrl(asString(value.url)) ?? "",
    enabled: asBoolean(value.enabled, true),
  };
}

function normalizePage(
  raw: unknown,
  index: number,
): PresentationContentPage | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const slug = inList(value.slug, CONTENT_PAGE_SLUGS, "about");
  return {
    id: safeId(value.id, `page-${index}`),
    slug,
    title: asString(value.title).slice(0, 80),
    enabled: asBoolean(value.enabled, false),
  };
}

/**
 * Narrows unknown / partial / stale configuration to a safe config.
 * Missing customizer config resolves to AWJ Modern defaults. Unsupported
 * tokens fail closed. Verification flags are stored but never authorize a
 * badge.
 */
export function normalizePresentationConfig(
  input?: unknown,
): StorefrontPresentationConfig {
  if (!input || typeof input !== "object") {
    return structuredClone(DEFAULT_PRESENTATION_CONFIG);
  }

  const raw = input as Record<string, unknown>;
  const brandingRaw =
    raw.branding && typeof raw.branding === "object"
      ? (raw.branding as Record<string, unknown>)
      : {};
  const headerRaw =
    raw.header && typeof raw.header === "object"
      ? (raw.header as Record<string, unknown>)
      : {};
  const homepageRaw =
    raw.homepage && typeof raw.homepage === "object"
      ? (raw.homepage as Record<string, unknown>)
      : {};
  const footerRaw =
    raw.footer && typeof raw.footer === "object"
      ? (raw.footer as Record<string, unknown>)
      : {};
  const contactRaw =
    raw.contact && typeof raw.contact === "object"
      ? (raw.contact as Record<string, unknown>)
      : {};
  const whatsappRaw =
    raw.whatsapp && typeof raw.whatsapp === "object"
      ? (raw.whatsapp as Record<string, unknown>)
      : {};
  const verificationRaw =
    raw.verification && typeof raw.verification === "object"
      ? (raw.verification as Record<string, unknown>)
      : {};
  const sbcRaw =
    raw.sbc && typeof raw.sbc === "object"
      ? (raw.sbc as Record<string, unknown>)
      : {};
  const appsRaw =
    raw.apps && typeof raw.apps === "object"
      ? (raw.apps as Record<string, unknown>)
      : {};

  const themePreset = inList(raw.themePreset, THEME_PRESETS.map((p) => p.id), "awj-modern");
  const primaryColor = isSafeHexColor(asString(raw.primaryColor))
    ? asString(raw.primaryColor).trim()
    : presetPrimary(themePreset);
  const accentRaw = asString(raw.accentColor).trim();
  const accentColor = isSafeHexColor(accentRaw) ? accentRaw : null;

  const iosUrl = asString(appsRaw.iosUrl);
  const androidUrl = asString(appsRaw.androidUrl);

  return {
    version: PRESENTATION_CONFIG_VERSION,
    themePreset,
    primaryColor,
    accentColor,
    fontPreset: inList(raw.fontPreset, FONT_PRESETS.map((p) => p.id), "cairo-geist"),
    density: inList(raw.density, DENSITY_PRESETS, "comfortable"),
    radius: inList(raw.radius, RADIUS_PRESETS.map((p) => p.id), "default"),
    productCard: inList(raw.productCard, PRODUCT_CARD_PRESETS, "standard"),
    branding: {
      displayName: asString(brandingRaw.displayName).slice(0, 80),
      logoDataUrl: sanitizeLogoUrl(asString(brandingRaw.logoDataUrl)),
      compactLogoDataUrl: sanitizeLogoUrl(asString(brandingRaw.compactLogoDataUrl)),
      faviconDataUrl: sanitizeLogoUrl(asString(brandingRaw.faviconDataUrl)),
    },
    header: {
      style: inList(headerRaw.style, HEADER_STYLES, "standard"),
      showSearch: asBoolean(headerRaw.showSearch, true),
      showAccount: asBoolean(headerRaw.showAccount, true),
      showCart: asBoolean(headerRaw.showCart, true),
      showCategoryNav: asBoolean(headerRaw.showCategoryNav, true),
      links: Array.isArray(headerRaw.links)
        ? headerRaw.links
            .map((link, index) => normalizeNavLink(link, index))
            .filter((link): link is PresentationNavLink => Boolean(link))
            .slice(0, 12)
        : DEFAULT_PRESENTATION_CONFIG.header.links.map((link) => ({ ...link })),
    },
    homepage: {
      sections: resolveHomeBuilderSections(
        homepageRaw.sections,
        !(typeof raw.version === "number" && raw.version >= 2),
      ),
      heroHeadline: asString(homepageRaw.heroHeadline).slice(0, 120),
      heroSubheadline: asString(homepageRaw.heroSubheadline).slice(0, 200),
    },
    footer: {
      tagline: asString(footerRaw.tagline).slice(0, 200),
      showLogo: asBoolean(footerRaw.showLogo, true),
      copyright: asString(footerRaw.copyright).slice(0, 120),
    },
    contact: {
      phone: asString(contactRaw.phone).slice(0, 40),
      email: asString(contactRaw.email).slice(0, 120),
      address: asString(contactRaw.address).slice(0, 200),
      hours: asString(contactRaw.hours).slice(0, 80),
    },
    whatsapp: {
      enabled: asBoolean(whatsappRaw.enabled, false),
      phone: asString(whatsappRaw.phone).slice(0, 20),
      message: asString(whatsappRaw.message).slice(0, 300),
      placement: inList(whatsappRaw.placement, PLACEMENTS, "floating"),
    },
    social: Array.isArray(raw.social)
      ? raw.social
          .map((item, index) => normalizeSocial(item, index))
          .filter((item): item is PresentationSocialLink => Boolean(item))
          .slice(0, 8)
      : [],
    verification: {
      crNumber: asString(verificationRaw.crNumber).slice(0, 40),
      licenseNumber: asString(verificationRaw.licenseNumber).slice(0, 40),
      sourceUrl: sanitizeExternalUrl(asString(verificationRaw.sourceUrl)) ?? "",
      // Legacy compatibility only; merchant input cannot mint an official verification claim.
      requestedVerifiedLabel: false,
    },
    sbc: {
      authentication_number: asString(sbcRaw.authentication_number).trim(),
      seal_token: asString(sbcRaw.seal_token).trim(),
      show_in_storefront: asBoolean(sbcRaw.show_in_storefront, false),
    },
    apps: {
      iosUrl: isSafeAppStoreUrl(iosUrl) ? (sanitizeExternalUrl(iosUrl) ?? "") : "",
      androidUrl: isSafePlayStoreUrl(androidUrl)
        ? (sanitizeExternalUrl(androidUrl) ?? "")
        : "",
      appName: asString(appsRaw.appName).slice(0, 80),
      showHomepageSection: asBoolean(appsRaw.showHomepageSection, false),
      showFooterLinks: asBoolean(appsRaw.showFooterLinks, false),
    },
    pages: Array.isArray(raw.pages)
      ? raw.pages
          .map((page, index) => normalizePage(page, index))
          .filter((page): page is PresentationContentPage => Boolean(page))
      : DEFAULT_PRESENTATION_CONFIG.pages.map((page) => ({ ...page })),
  };
}

export function isGatedHomeSection(key: HomeBuilderSectionKey): boolean {
  return (GATED_HOME_SECTION_KEYS as readonly string[]).includes(key);
}

export function clonePresentationConfig(
  config: StorefrontPresentationConfig,
): StorefrontPresentationConfig {
  return structuredClone(config);
}

export function presentationConfigsEqual(
  a: StorefrontPresentationConfig,
  b: StorefrontPresentationConfig,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Display name used in the preview. Empty string falls back to the live store name. */
export function previewStoreName(
  config: StorefrontPresentationConfig,
  liveName: string | null,
  fallback: string,
): string {
  const fromConfig = config.branding.displayName.trim();
  if (fromConfig) return fromConfig;
  const fromLive = liveName?.trim();
  if (fromLive) return fromLive;
  return fallback;
}
