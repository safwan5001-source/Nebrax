import { DEFAULT_HOME_SECTIONS } from "@/lib/home/sections";

export const PRESENTATION_CONFIG_VERSION = 2 as const;

export const THEME_PRESETS = [
  { id: "awj-modern", primary: "#12372a", labelKey: "presetAwjModern" },
  { id: "navy", primary: "#1e3a5f", labelKey: "presetNavy" },
  { id: "burgundy", primary: "#7f1d1d", labelKey: "presetBurgundy" },
  { id: "sand", primary: "#92400e", labelKey: "presetSand" },
  { id: "slate", primary: "#334155", labelKey: "presetSlate" },
] as const;

export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"];

export const FONT_PRESETS = [
  { id: "cairo-geist", labelKey: "fontCairoGeist" },
] as const;

export type FontPresetId = (typeof FONT_PRESETS)[number]["id"];

export const DENSITY_PRESETS = ["comfortable", "compact"] as const;
export type DensityId = (typeof DENSITY_PRESETS)[number];

export const RADIUS_PRESETS = [
  { id: "default", value: "0.75rem" },
  { id: "subtle", value: "0.5rem" },
  { id: "sharp", value: "0.25rem" },
] as const;
export type RadiusId = (typeof RADIUS_PRESETS)[number]["id"];

export const PRODUCT_CARD_PRESETS = ["standard", "compact"] as const;
export type ProductCardStyleId = (typeof PRODUCT_CARD_PRESETS)[number];

export const HEADER_STYLES = ["standard", "compact"] as const;
export type HeaderStyleId = (typeof HEADER_STYLES)[number];

export const HOME_BUILDER_SECTION_KEYS = [
  "hero",
  "categories",
  "newArrivals",
  "wholesale",
  "banner",
  "featured",
  "offers",
  "benefits",
  "appPromo",
  "customContent",
] as const;

export type HomeBuilderSectionKey = (typeof HOME_BUILDER_SECTION_KEYS)[number];

/** Sections the public storefront actually renders today. */
export const IMPLEMENTED_HOME_SECTION_KEYS = DEFAULT_HOME_SECTIONS.map(
  (section) => section.key,
);

export const GATED_HOME_SECTION_KEYS = [
  "banner",
  "featured",
  "offers",
  "benefits",
  "appPromo",
  "customContent",
] as const satisfies readonly HomeBuilderSectionKey[];

export const SOCIAL_NETWORKS = [
  "instagram",
  "x",
  "tiktok",
  "snapchat",
  "youtube",
  "linkedin",
  "facebook",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const CONTENT_PAGE_SLUGS = [
  "about",
  "contact",
  "faq",
  "shipping-policy",
  "privacy-policy",
  "returns-policy",
  "terms-of-service",
] as const;
export type ContentPageSlug = (typeof CONTENT_PAGE_SLUGS)[number];

const HEX = /^#([0-9a-fA-F]{6})$/;

export function isSafeHexColor(
  value: string | null | undefined,
): value is string {
  return Boolean(value && HEX.test(value.trim()));
}

function channel(n: number): number {
  const c = n / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = hex.trim();
  const match = HEX.exec(value);
  if (!match) return 0;
  const int = Number.parseInt(match[1], 16);
  const r = channel((int >> 16) & 255);
  const g = channel((int >> 8) & 255);
  const b = channel(int & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

export function primaryForeground(hex: string): "#ffffff" | "#111827" {
  return contrastRatio(hex, "#ffffff") >= 4.5 ? "#ffffff" : "#111827";
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHex(hex: string, other: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  if (!a || !b) return hex;
  return rgbToHex(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  );
}

export function radiusToken(id: RadiusId): string {
  return RADIUS_PRESETS.find((preset) => preset.id === id)?.value ?? "0.75rem";
}

/**
 * CSS custom properties applied to the preview (and, later, the published
 * storefront). Unknown or unreadable colours fall back to AWJ Modern.
 */
export function presentationCssVars(
  primary: string,
  radius: RadiusId,
): Record<string, string> {
  const color = isSafeHexColor(primary) ? primary.trim() : "#12372a";
  const foreground = primaryForeground(color);
  return {
    "--store-primary": color,
    "--store-primary-600": color,
    "--store-primary-500": mixHex(color, "#ffffff", 0.18),
    "--store-primary-700": mixHex(color, "#000000", 0.18),
    "--store-primary-800": mixHex(color, "#000000", 0.32),
    "--store-primary-50": mixHex(color, "#ffffff", 0.92),
    "--store-primary-hover": mixHex(color, "#000000", 0.32),
    "--store-primary-foreground": foreground,
    "--store-primary-soft": mixHex(color, "#ffffff", 0.92),
    "--store-radius": radiusToken(radius),
    "--primary": color,
    "--primary-foreground": foreground,
    "--ring": color,
    "--radius": radiusToken(radius),
  };
}

export function presetPrimary(id: ThemePresetId): string {
  return THEME_PRESETS.find((preset) => preset.id === id)?.primary ?? "#12372a";
}
