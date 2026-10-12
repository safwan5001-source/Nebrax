/**
 * CUST-HV V10a (V0 §16) — the pure core of "Apply theme": from a document and a theme, the document a NEW Draft Version would
 * hold and the Apply summary (which design areas change, which are kept). It performs no I/O: the caller (V10b) creates the
 * Draft Version, saves it revision-checked and rolls it back on failure; a Published Version is never an input to a write.
 *
 * A theme is a complete visual system, so within the areas it covers the result is the theme's own value — or the store's
 * default where the theme says nothing (absence = default, §2.2). Everything that is content stays exactly as it was: copy,
 * media, links, logos, navigation, announcements, and every section's order and visibility.
 */

import { type StorefrontPresentationConfig, normalizePresentationConfig } from "../presentation/config";
import { normalizeSectionDesign } from "../presentation/section-design";
import type { ThemeDefinition } from "./theme-definition";

export const THEME_AREAS = [
  "identity",
  "typography",
  "buttons",
  "surfaces",
  "cards",
  "layout",
  "motion",
  "header",
  "footer",
  "sections",
] as const;
export type ThemeArea = (typeof THEME_AREAS)[number];

/** What a theme application never touches — shown in the Apply summary so the merchant sees what stays. */
export const THEME_KEPT = [
  "content",
  "media",
  "links",
  "logos",
  "navigation",
  "announcements",
  "order",
  "visibility",
] as const;
export type ThemeKept = (typeof THEME_KEPT)[number];

export interface ThemeAreaChange {
  area: ThemeArea;
  changed: boolean;
  /** `sections` only: the ids of the sections whose design changes. */
  sectionIds?: string[];
}

export interface ThemeApplySummary {
  areas: ThemeAreaChange[];
  kept: readonly ThemeKept[];
  /** True when applying changes nothing at all. */
  noop: boolean;
}

export type ThemeApplication =
  | { ok: true; config: StorefrontPresentationConfig; summary: ThemeApplySummary }
  | { ok: false; reason: "assets_unsupported" };

type Mutable = Record<string, unknown>;

function setOrDelete(target: Mutable, key: string, value: unknown) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function slices(config: StorefrontPresentationConfig): Record<Exclude<ThemeArea, "sections">, unknown> {
  return {
    identity: [config.themePreset, config.primaryColor, config.accentColor, config.palette, config.fontPreset],
    typography: config.typography,
    buttons: config.buttons,
    surfaces: [config.surfaces, config.radius],
    cards: [config.cards, config.productCard],
    layout: [config.layout, config.density],
    motion: config.motion,
    header: [config.header.style, config.header.design],
    footer: [config.footer.layout, config.footer.design],
  };
}

export function applyTheme(
  config: StorefrontPresentationConfig,
  theme: ThemeDefinition,
): ThemeApplication {
  // A theme with stock imagery needs the clone-on-apply service (V0 §7.9, AMEND-6). Until it exists such a theme fails closed:
  // a global theme asset is never written into a tenant's document.
  if (theme.assets && theme.assets.length > 0) return { ok: false, reason: "assets_unsupported" };

  const before = normalizePresentationConfig(config);
  const draft = structuredClone(before) as unknown as Mutable & {
    header: Mutable;
    footer: Mutable;
    homepage: { sections: Array<Mutable & { type: string }> };
  };

  draft.themePreset = theme.themePreset;
  draft.primaryColor = theme.primaryColor;
  draft.accentColor = theme.accentColor ?? null;
  delete draft.palette;
  draft.fontPreset = theme.fontPreset ?? "cairo-geist";
  draft.density = theme.density ?? "comfortable";
  draft.productCard = theme.productCard ?? "standard";
  draft.radius = theme.radius ?? "default";
  setOrDelete(draft, "typography", theme.typography);
  setOrDelete(draft, "buttons", theme.buttons);
  setOrDelete(draft, "surfaces", theme.surfaces);
  setOrDelete(draft, "cards", theme.cards);
  setOrDelete(draft, "layout", theme.layout);
  setOrDelete(draft, "motion", theme.motion);
  draft.header.style = theme.header?.style ?? "standard";
  setOrDelete(draft.header, "design", theme.header?.design);
  setOrDelete(draft.footer, "layout", theme.footer?.layout);
  setOrDelete(draft.footer, "design", theme.footer?.design);

  for (const section of draft.homepage.sections) {
    setOrDelete(section, "design", normalizeSectionDesign(section.type, theme.sectionDefaults?.[section.type]));
  }

  const after = normalizePresentationConfig(draft);

  const b = slices(before);
  const a = slices(after);
  const areas: ThemeAreaChange[] = THEME_AREAS.map((area) => {
    if (area === "sections") {
      const sectionIds = after.homepage.sections
        .filter((section, index) => !same(section.design, before.homepage.sections[index]?.design))
        .map((section) => section.id);
      return { area, changed: sectionIds.length > 0, sectionIds };
    }
    return { area, changed: !same(b[area], a[area]) };
  });

  return {
    ok: true,
    config: after,
    summary: { areas, kept: THEME_KEPT, noop: areas.every((entry) => !entry.changed) },
  };
}
