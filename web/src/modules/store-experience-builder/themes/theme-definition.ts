/**
 * CUST-HV V10a (V0 §16, D-30) — a theme is a complete visual system expressed ONLY in the typed tokens the document already
 * has: identity, typography, buttons, surfaces, cards, layout, motion, header, footer and per-type section styles. It carries no
 * content, no link, no merchant media and no commerce value (V0 §14.3). A theme that ships stock imagery lists it in `assets`
 * (a global, tenant-less namespace — AMEND-6); applying such a theme is GATED until the clone-on-apply service exists, so no
 * built-in theme lists any.
 */

import type { FooterDesign, FooterLayout } from "../presentation/footer-design";
import type { GlobalTokensDoc } from "../presentation/global-tokens";
import type { HeaderDesign } from "../presentation/header-design";
import type { SectionDesign } from "../presentation/section-design";
import type {
  DensityId,
  FontPresetId,
  HeaderStyleId,
  ProductCardStyleId,
  RadiusId,
  ThemePresetId,
} from "../presentation/tokens";

export type ThemeVertical = "general" | "retail" | "floral" | "wholesale";

/** An AWJ-owned source asset in the global theme-asset namespace. Never a `MediaRef`, never a `storefront_media` row. */
export interface ThemeAssetRef {
  key: string;
}

export interface ThemeDefinition {
  id: string;
  version: 1;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  vertical: ThemeVertical;
  /** The existing runtime theme preset the bundle builds on (one of the allow-listed presets). */
  themePreset: ThemePresetId;
  primaryColor: string;
  accentColor?: string;
  fontPreset?: FontPresetId;
  density?: DensityId;
  productCard?: ProductCardStyleId;
  radius?: RadiusId;
  typography?: GlobalTokensDoc["typography"];
  buttons?: GlobalTokensDoc["buttons"];
  surfaces?: GlobalTokensDoc["surfaces"];
  cards?: GlobalTokensDoc["cards"];
  layout?: GlobalTokensDoc["layout"];
  motion?: GlobalTokensDoc["motion"];
  header?: { style?: HeaderStyleId; design?: HeaderDesign };
  footer?: { layout?: FooterLayout; design?: FooterDesign };
  /** Default design per section type; a type without an entry is reset to the store's defaults on apply. */
  sectionDefaults?: Partial<Record<string, SectionDesign>>;
  /** Backed section packs the theme may add on apply (the caller supplies what the store can back). */
  pack?: "flowers-gifts";
  assets?: ThemeAssetRef[];
}
