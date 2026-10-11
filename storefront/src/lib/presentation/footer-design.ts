/**
 * CUST-HV V7e-1 — footer layout, link groups and design (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §10).
 *
 * Three optional, additive keys inside `footer` — `layout`, `groups`, `design` — typed and enumerated, never a style bag.
 * An invalid value is dropped on its own, an empty group is omitted, and **an absent key ⇒ the storefront renders
 * byte-identically to before** (§2.2). `PRESENTATION_CONFIG_VERSION` stays 3.
 *
 * Twin of `web/.../presentation/footer-design.ts` (byte-identical, test-enforced) and of PHP
 * `App\Support\Commerce\StorefrontFooterNormalizer` (the authority); all three are pinned by
 * `tests/Fixtures/presentation/footer-design.json`. The explicit text / heading / link colours are judged by
 * `footerContrastIssues` (twin of PHP `FooterDesignContrast`, pinned by `footer-contrast.json`); the automatic colour
 * over a designed background is the best of pure white / black and passes by construction.
 *
 * Deliberately NOT here yet (dropped fail-closed): media / gradient / `alpha` surfaces, `divider.kind` / `height`,
 * `border`, `logo.treatment`, `linkHover` (the hover colour follows the heading colour).
 */

import {
  autoForeground,
  parseHex,
  passes,
  solidInterval,
  worstRatioForHex,
} from "./contrast-engine";
import { type NavItem, normalizeNavFlatItems } from "./navigation";
import { type PresentationPalette, resolveRoleHex } from "./palette";
import { type ColorRef, normalizeColorRef } from "./section-design";
import { mixHex } from "./tokens";

export const FOOTER_LAYOUTS = [
  "compact",
  "columns",
  "centered",
  "editorial",
  "minimal",
  "brand-heavy",
] as const;
export const FOOTER_MAX_GROUPS = 6;
export const FOOTER_MAX_LINKS = 8;
export const FOOTER_TITLE_MAX = 40;
export const FOOTER_SPANS = [1, 2] as const;
export const FOOTER_SPACING = ["sm", "md", "lg"] as const;
export const FOOTER_LOGO_SIZES = ["sm", "md", "lg"] as const;
export const FOOTER_ALIGNS = ["start", "center", "end"] as const;
/** The footer surface a footer without a designed background sits on (`--store-footer`). */
export const FOOTER_DEFAULT_BACKDROP = "#111827";

export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];
export type FooterSpacing = (typeof FOOTER_SPACING)[number];
export type FooterLogoSize = (typeof FOOTER_LOGO_SIZES)[number];
export type FooterAlign = (typeof FOOTER_ALIGNS)[number];

export interface FooterGroup {
  id: string;
  title: string;
  /** A `navigation.menus[].id`; a missing menu degrades to the group's own `links` (or the group is omitted). */
  menu?: string;
  links?: NavItem[];
  span?: (typeof FOOTER_SPANS)[number];
}

export interface FooterDesign {
  surface?: { background: ColorRef };
  text?: ColorRef;
  heading?: ColorRef;
  link?: ColorRef;
  divider?: { color: ColorRef };
  spacing?: { top?: FooterSpacing; bottom?: FooterSpacing };
  logo?: { size: FooterLogoSize };
  align?: FooterAlign;
}

/** What the three optional keys carry; each is present only when it survived normalisation. */
export interface FooterExtras {
  layout?: FooterLayout;
  groups?: FooterGroup[];
  design?: FooterDesign;
}

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function uniqueId(base: string, seen: Set<string>): string {
  let id = base;
  for (let n = 2; seen.has(id); n++) {
    const suffix = `-${n}`;
    id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
  }
  seen.add(id);
  return id;
}

function normalizeGroups(raw: unknown): FooterGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const groups: FooterGroup[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isObject(entry)) continue;
    const idText = str(entry.id).trim();
    const group: FooterGroup = {
      id: uniqueId(ID.test(idText) ? idText : `group-${index}`, seen),
      title: str(entry.title).slice(0, FOOTER_TITLE_MAX),
    };
    const menu = str(entry.menu).trim();
    if (ID.test(menu)) group.menu = menu;
    const links = normalizeNavFlatItems(entry.links, FOOTER_MAX_LINKS);
    if (links.length > 0) group.links = links;
    const span = (FOOTER_SPANS as readonly unknown[]).find(
      (s) => s === entry.span,
    );
    if (span !== undefined) group.span = span as FooterGroup["span"];
    groups.push(group);
    if (groups.length >= FOOTER_MAX_GROUPS) break;
  }
  return groups;
}

export function normalizeFooterDesign(raw: unknown): FooterDesign | undefined {
  if (!isObject(raw)) return undefined;
  const out: FooterDesign = {};

  if (isObject(raw.surface)) {
    const background = normalizeColorRef(raw.surface.background);
    if (background) out.surface = { background };
  }
  for (const field of ["text", "heading", "link"] as const) {
    const ref = normalizeColorRef(raw[field]);
    if (ref) out[field] = ref;
  }
  if (isObject(raw.divider)) {
    const color = normalizeColorRef(raw.divider.color);
    if (color) out.divider = { color };
  }
  if (isObject(raw.spacing)) {
    const spacing: NonNullable<FooterDesign["spacing"]> = {};
    const top = pick(raw.spacing.top, FOOTER_SPACING);
    if (top) spacing.top = top;
    const bottom = pick(raw.spacing.bottom, FOOTER_SPACING);
    if (bottom) spacing.bottom = bottom;
    if (Object.keys(spacing).length > 0) out.spacing = spacing;
  }
  if (isObject(raw.logo)) {
    const size = pick(raw.logo.size, FOOTER_LOGO_SIZES);
    if (size) out.logo = { size };
  }
  const align = pick(raw.align, FOOTER_ALIGNS);
  if (align) out.align = align;

  return Object.keys(out).length > 0 ? out : undefined;
}

/** The valid `layout` / `groups` / `design` of a raw `footer` object, in canonical order; `{}` when none survive. */
export function normalizeFooterExtras(raw: unknown): FooterExtras {
  if (!isObject(raw)) return {};
  const out: FooterExtras = {};
  const layout = pick(raw.layout, FOOTER_LAYOUTS);
  if (layout) out.layout = layout;
  const groups = normalizeGroups(raw.groups);
  if (groups.length > 0) out.groups = groups;
  const design = normalizeFooterDesign(raw.design);
  if (design) out.design = design;
  return out;
}

/** What a colour reference needs to become a hex: the brand / accent and the palette. */
export interface FooterColourContext {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
}

function colourHex(ref: ColorRef, ctx: FooterColourContext): string {
  return "role" in ref ? resolveRoleHex(ref.role, ctx) : ref.hex;
}

export interface FooterContrastIssue {
  field: "text" | "heading" | "link";
  code: "contrast_insufficient";
  ratio: number;
}

/**
 * Twin of PHP `FooterDesignContrast::issues` — the verdict the publish gate returns as a 422, shown live in the editor.
 * Only an **explicit** text / heading / link colour is judged (≥ 4.5:1 against what is really behind it: the designed
 * background, else the default footer surface).
 */
export function footerContrastIssues(
  design: FooterDesign | undefined,
  ctx: FooterColourContext,
): FooterContrastIssue[] {
  if (!design) return [];
  const backdrop = design.surface
    ? colourHex(design.surface.background, ctx)
    : FOOTER_DEFAULT_BACKDROP;
  const rgb = parseHex(backdrop);
  if (!rgb) return [];
  const issues: FooterContrastIssue[] = [];
  for (const field of ["text", "heading", "link"] as const) {
    const ref = design[field];
    if (!ref) continue;
    const ratio = worstRatioForHex(colourHex(ref, ctx), solidInterval(rgb));
    if (!passes(ratio)) {
      issues.push({
        field,
        code: "contrast_insufficient",
        ratio: Math.round(ratio * 10000) / 10000,
      });
    }
  }
  return issues;
}

export interface ResolvedFooterDesign {
  /**
   * Validated `--store-footer*` custom properties for the `<footer>` element: they override the theme's footer tokens, so every
   * existing footer class (`bg-store-footer`, `text-store-footer-link` …) follows with no new CSS. Undefined ⇒ none at all.
   */
  style?: Record<string, string>;
  spacing: { top: FooterSpacing; bottom: FooterSpacing };
  logoSize: FooterLogoSize | undefined;
  align: FooterAlign | undefined;
  /** True when any design key is set. */
  designed: boolean;
}

/** Whether `mixed` (a step from `from` toward `bg`) still clears 4.5:1 against `bg`. */
function mixedPasses(mixed: string, bg: string): boolean {
  const rgb = parseHex(bg);
  return rgb ? passes(worstRatioForHex(mixed, solidInterval(rgb))) : false;
}

/**
 * The one pure function from the document to what the footer renderer needs. Over a **designed background** every colour
 * the merchant did not choose is derived and proven by construction: the heading is the best of pure white / black, the body
 * (muted) text and the links are a step toward the background taken only while they still clear 4.5:1, else the full
 * foreground; the divider is a decorative tint. Without a designed background only the explicit colours are emitted, each
 * overriding exactly the one token it names — and an explicit colour is gated at Publish (`footerContrastIssues`).
 * No string from the document ever reaches CSS: every value is a validated hex.
 */
export function resolveFooterDesign(
  design: FooterDesign | undefined,
  ctx?: FooterColourContext,
): ResolvedFooterDesign {
  const style: Record<string, string> = {};
  if (design && ctx) {
    const bg = design.surface
      ? colourHex(design.surface.background, ctx)
      : null;
    const bgRgb = bg ? parseHex(bg) : null;
    const explicit = {
      heading: design.heading ? colourHex(design.heading, ctx) : null,
      text: design.text ? colourHex(design.text, ctx) : null,
      link: design.link ? colourHex(design.link, ctx) : null,
      divider: design.divider ? colourHex(design.divider.color, ctx) : null,
    };
    if (bg && bgRgb) {
      const fg = autoForeground(solidInterval(bgRgb));
      style["--store-footer"] = bg;
      style["--store-footer-foreground"] = explicit.heading ?? fg;
      const step = (amounts: number[]) =>
        amounts.map((a) => mixHex(fg, bg, a)).find((m) => mixedPasses(m, bg)) ??
        fg;
      style["--store-footer-muted"] = explicit.text ?? step([0.35, 0.22]);
      style["--store-footer-link"] = explicit.link ?? step([0.18]);
      style["--store-footer-border"] = explicit.divider ?? mixHex(bg, fg, 0.18);
    } else {
      if (explicit.heading)
        style["--store-footer-foreground"] = explicit.heading;
      if (explicit.text) style["--store-footer-muted"] = explicit.text;
      if (explicit.link) style["--store-footer-link"] = explicit.link;
      if (explicit.divider) style["--store-footer-border"] = explicit.divider;
    }
  }
  return {
    ...(Object.keys(style).length > 0 ? { style } : {}),
    spacing: {
      top: design?.spacing?.top ?? "md",
      bottom: design?.spacing?.bottom ?? "md",
    },
    logoSize: design?.logo?.size,
    align: design?.align,
    designed: design !== undefined,
  };
}
