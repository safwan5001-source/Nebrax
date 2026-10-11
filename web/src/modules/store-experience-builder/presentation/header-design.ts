/**
 * CUST-HV V7a — structural header design (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §9.1).
 *
 * One optional, additive key — `header.design` — a typed, enumerated object, never a style bag.
 * An invalid value is dropped on its own, an empty group is omitted, and **an absent key ⇒ the
 * storefront renders byte-identically to before** (§2.2). `PRESENTATION_CONFIG_VERSION` stays 3.
 *
 * Twin of `web/.../presentation/header-design.ts` (byte-identical, test-enforced) and of PHP
 * `App\Support\Commerce\StorefrontHeaderDesignNormalizer` (the authority); all three are pinned
 * by `tests/Fixtures/presentation/header-design.json`.
 *
 * V7a is structural: `layout`, `mobileLayout`, `height`, `logo.size`, `sticky` (`always | off`),
 * `border.width`, `shadow`. V7b adds colour — `surface.background`, `text`, `icon` (a `ColorRef`: a
 * palette role or a hex). The text colour over a designed background defaults to the best of pure
 * white / black (proven by construction); an **explicit** `text` / `icon` is judged against what is
 * really behind it at publish (`headerContrastIssues`, twin of PHP `HeaderDesignContrast`, pinned
 * by `tests/Fixtures/presentation/header-contrast.json`).
 *
 * V7c-1 adds `sticky: on-scroll-up`: the header stays reachable but leaves the way while the shopper
 * reads downward and returns on the first upward scroll (`stepScrollUp`, one pure rule shared by the
 * storefront and the Canvas simulator).
 *
 * V7c-2 adds `mode: overlay-hero` (the contract's `transparent` stays rejected: a transparent header is only
 * ever safe over a backdrop the proof knows, and that is exactly `overlay-hero`).
 *
 * Deliberately NOT here yet (dropped fail-closed until their slice): `surface.alpha` / gradients, explicit `search` / `categoryNav` presentation, `logo.align` / `logo.treatment`.
 *
 * `resolveHeaderDesign` is the one pure function from the document to what a renderer needs: a
 * `data-hd` token list plus validated `--hd-*` custom properties for the theme wrapper (heights,
 * sticky offset, borders, shadow, colours — CSS in `globals.css`) and the validated structural
 * choices the `Header` component maps onto literal class names. No string from the document is
 * ever interpolated into CSS or a class.
 */

import {
  autoForeground,
  parseHex,
  passes,
  solidInterval,
  worstRatioForHex,
} from "./contrast-engine";
import { type PresentationPalette, resolveRoleHex } from "./palette";
import { type ColorRef, normalizeColorRef } from "./section-design";
import { mixHex } from "./tokens";

export const HEADER_LAYOUTS = [
  "standard",
  "compact",
  "centered",
  "two-row",
] as const;
export const HEADER_MOBILE_LAYOUTS = ["logo-centre", "logo-start"] as const;
export const HEADER_HEIGHTS = ["compact", "standard", "tall"] as const;
export const HEADER_LOGO_SIZES = ["sm", "md", "lg", "xl"] as const;
export const HEADER_MODES = ["solid", "overlay-hero"] as const;
export const HEADER_STICKY = ["always", "on-scroll-up", "off"] as const;
export const HEADER_BORDER_WIDTHS = ["none", "hairline", "medium"] as const;
export const HEADER_SHADOWS = ["none", "soft", "medium"] as const;

export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];
export type HeaderMobileLayout = (typeof HEADER_MOBILE_LAYOUTS)[number];
export type HeaderHeight = (typeof HEADER_HEIGHTS)[number];
export type HeaderLogoSize = (typeof HEADER_LOGO_SIZES)[number];
export type HeaderMode = (typeof HEADER_MODES)[number];
export type HeaderSticky = (typeof HEADER_STICKY)[number];
export type HeaderBorderWidth = (typeof HEADER_BORDER_WIDTHS)[number];
export type HeaderShadow = (typeof HEADER_SHADOWS)[number];

export interface HeaderDesign {
  layout?: HeaderLayout;
  mobileLayout?: HeaderMobileLayout;
  height?: HeaderHeight;
  logo?: { size: HeaderLogoSize };
  /** V7b — the identity row's background (and the header's own). */
  surface?: { background: ColorRef };
  /** V7b — the identity row's text colour; absent over a designed background ⇒ the proven auto colour. */
  text?: ColorRef;
  /** V7b — the identity row's icon colour; absent ⇒ the text colour. */
  icon?: ColorRef;
  /** V7c-2 — `overlay-hero`: transparent over a proven full-bleed picture hero on Home (see `header-overlay.ts`). */
  mode?: HeaderMode;
  sticky?: HeaderSticky;
  border?: { width: HeaderBorderWidth };
  shadow?: HeaderShadow;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** The valid fields of a raw `header.design`, in canonical order; `undefined` when none survive. */
export function normalizeHeaderDesign(raw: unknown): HeaderDesign | undefined {
  if (!isObject(raw)) return undefined;
  const out: HeaderDesign = {};

  const layout = pick(raw.layout, HEADER_LAYOUTS);
  if (layout) out.layout = layout;
  const mobileLayout = pick(raw.mobileLayout, HEADER_MOBILE_LAYOUTS);
  if (mobileLayout) out.mobileLayout = mobileLayout;
  const height = pick(raw.height, HEADER_HEIGHTS);
  if (height) out.height = height;

  if (isObject(raw.logo)) {
    const size = pick(raw.logo.size, HEADER_LOGO_SIZES);
    if (size) out.logo = { size };
  }

  if (isObject(raw.surface)) {
    const background = normalizeColorRef(raw.surface.background);
    if (background) out.surface = { background };
  }
  const text = normalizeColorRef(raw.text);
  if (text) out.text = text;
  const icon = normalizeColorRef(raw.icon);
  if (icon) out.icon = icon;

  const mode = pick(raw.mode, HEADER_MODES);
  if (mode) out.mode = mode;

  const sticky = pick(raw.sticky, HEADER_STICKY);
  if (sticky) out.sticky = sticky;

  if (isObject(raw.border)) {
    const width = pick(raw.border.width, HEADER_BORDER_WIDTHS);
    if (width) out.border = { width };
  }

  const shadow = pick(raw.shadow, HEADER_SHADOWS);
  if (shadow) out.shadow = shadow;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Whether the header is the compact variant: the compact logo and no utility strip. The new
 * `design.layout` wins when present (`standard` ⇒ not compact even if the legacy `style` says
 * so); otherwise the legacy `header.style` stays the source — absent design ⇒ unchanged.
 */
export function headerIsCompact(header: {
  style: string;
  design?: HeaderDesign;
}): boolean {
  return header.design?.layout
    ? header.design.layout === "compact"
    : header.style === "compact";
}

/** The desktop structure the identity row takes (`compact` renders as `standard`'s row). */
export function headerDesktopLayout(
  design: HeaderDesign | undefined,
): "standard" | "centered" | "two-row" {
  const layout = design?.layout;
  return layout === "centered" || layout === "two-row" ? layout : "standard";
}

/** What a colour reference needs to become a hex: the brand / accent and the palette. */
export interface HeaderColourContext {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
}

/** The default header surface a header without a designed background sits on. */
export const HEADER_DEFAULT_BACKDROP = "#ffffff";

function colourHex(ref: ColorRef, ctx: HeaderColourContext): string {
  return "role" in ref ? resolveRoleHex(ref.role, ctx) : ref.hex;
}

/** What is really drawn behind the header's text: the designed background, else the store surface(s). */
function backdropHexes(
  design: HeaderDesign,
  ctx: HeaderColourContext,
): string[] {
  if (design.surface) return [colourHex(design.surface.background, ctx)];
  const list = [HEADER_DEFAULT_BACKDROP];
  const surface = ctx.palette?.surface;
  if (surface && parseHex(surface)) list.push(surface);
  return list;
}

export interface HeaderContrastIssue {
  field: "text" | "icon";
  code: "contrast_insufficient";
  ratio: number;
}

/**
 * Twin of PHP `HeaderDesignContrast::issues` — the verdict the publish gate returns as a 422,
 * shown live in the editor. Only an **explicit** `text` / `icon` is judged (≥ 4.5:1 against every
 * possible backdrop); the automatic colour over a designed background passes by construction.
 */
export function headerContrastIssues(
  design: HeaderDesign | undefined,
  ctx: HeaderColourContext,
): HeaderContrastIssue[] {
  if (!design) return [];
  const backdrops = backdropHexes(design, ctx);
  const issues: HeaderContrastIssue[] = [];
  for (const field of ["text", "icon"] as const) {
    const ref = design[field];
    if (!ref) continue;
    const hex = colourHex(ref, ctx);
    let worst: number | null = null;
    for (const backdrop of backdrops) {
      const rgb = parseHex(backdrop);
      if (!rgb) continue;
      const ratio = worstRatioForHex(hex, solidInterval(rgb));
      worst = worst === null ? ratio : Math.min(worst, ratio);
    }
    if (worst !== null && !passes(worst)) {
      issues.push({
        field,
        code: "contrast_insufficient",
        ratio: Math.round(worst * 10000) / 10000,
      });
    }
  }
  return issues;
}

export interface ResolvedHeaderDesign {
  /** `data-hd` token list for the theme wrapper; undefined ⇒ no attribute at all. */
  attrs?: { "data-hd": string };
  /** Validated `--hd-*` custom properties for the same element; undefined ⇒ none. */
  style?: Record<string, string>;
  layout: "standard" | "centered" | "two-row";
  mobileLayout: HeaderMobileLayout;
  logoSize: HeaderLogoSize | undefined;
  sticky: HeaderSticky;
  /** True when any structural choice is set — the identity row then sizes with `min-h`. */
  designed: boolean;
  /** V7c-2 — the document opted into overlay-on-hero (whether a page honours it is decided per page, in the stylesheet). */
  overlay: boolean;
  /** True when the identity row's text colour is chosen (explicitly, or automatically over a designed background). */
  coloured: boolean;
}

/**
 * Token legend (the CSS lives in `globals.css`, block "CUST-HV V7a — header design"):
 * `hh-c` / `hh-t` compact / tall height · `hl-2` two-row (taller sticky offset) ·
 * `hs-o` sticky off (offset collapses to the announcement bar) · `hs-u` sticky on-scroll-up · `hmo` opted into
 * overlay-on-hero (active only on a page whose hero carries the overlay marker — `header-overlay.ts`) · `hb-n` / `hb-m` no / medium
 * border · `hx-s` / `hx-m` soft / medium shadow · `hbg` designed background · `htx` chosen text
 * colour · `hic` explicit icon colour. Defaults (`standard`, `always`, `hairline`, `none`) emit no
 * token — they are the rendering that already exists.
 */
export function resolveHeaderDesign(
  design: HeaderDesign | undefined,
  ctx?: HeaderColourContext,
): ResolvedHeaderDesign {
  const tokens: string[] = [];
  const style: Record<string, string> = {};
  let coloured = false;

  if (design && ctx && (design.surface || design.text || design.icon)) {
    const bg = design.surface
      ? colourHex(design.surface.background, ctx)
      : null;
    const bgRgb = bg ? parseHex(bg) : null;
    const explicitText = design.text ? colourHex(design.text, ctx) : null;
    const fg =
      explicitText ?? (bgRgb ? autoForeground(solidInterval(bgRgb)) : null);
    if (bg && bgRgb) {
      tokens.push("hbg");
      style["--hd-bg"] = bg;
    }
    if (fg && parseHex(fg)) {
      tokens.push("htx");
      coloured = true;
      style["--hd-fg"] = fg;
      // Secondary text (nav links, the region line): a step toward the background, only when that
      // still clears 4.5:1 against it; otherwise the full foreground.
      let muted = fg;
      if (bgRgb) {
        const mixed = mixHex(fg, bg as string, 0.22);
        if (passes(worstRatioForHex(mixed, solidInterval(bgRgb))))
          muted = mixed;
      }
      style["--hd-muted"] = muted;
    }
    if (design.icon) {
      tokens.push("hic");
      style["--hd-icon"] = colourHex(design.icon, ctx);
    }
  }

  if (design?.height === "compact") tokens.push("hh-c");
  if (design?.height === "tall") tokens.push("hh-t");
  if (design?.layout === "two-row") tokens.push("hl-2");
  if (design?.sticky === "off") tokens.push("hs-o");
  if (design?.sticky === "on-scroll-up") tokens.push("hs-u");
  if (design?.mode === "overlay-hero") tokens.push("hmo");
  if (design?.border?.width === "none") tokens.push("hb-n");
  if (design?.border?.width === "medium") tokens.push("hb-m");
  if (design?.shadow === "soft") tokens.push("hx-s");
  if (design?.shadow === "medium") tokens.push("hx-m");

  return {
    ...(tokens.length > 0 ? { attrs: { "data-hd": tokens.join(" ") } } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
    layout: headerDesktopLayout(design),
    mobileLayout: design?.mobileLayout ?? "logo-centre",
    logoSize: design?.logo?.size,
    sticky: design?.sticky ?? "always",
    designed: design !== undefined,
    overlay: design?.mode === "overlay-hero",
    coloured,
  };
}

/** Upward / downward movement (px) below which a scroll event is treated as jitter and ignored. */
export const SCROLL_UP_JITTER_PX = 4;

export interface ScrollUpState {
  hidden: boolean;
  /** The scroll position the last real movement was measured from. */
  lastY: number;
}

/**
 * The `on-scroll-up` rule (V0 §9.2), pure so the storefront (window scroll) and the Canvas simulator
 * (the preview pane's scroll) cannot disagree: the header is **never hidden** within its own height of
 * the top, nor while the shopper is working inside it (`pinned`: focus within, an open menu / search);
 * past that it hides on a downward movement and returns on the first upward one. Movements under
 * `SCROLL_UP_JITTER_PX` change nothing, and overscroll (negative `y`) counts as the top.
 */
export function stepScrollUp(
  prev: ScrollUpState,
  y: number,
  headerHeight: number,
  pinned: boolean,
): ScrollUpState {
  const at = Math.max(0, y);
  if (pinned || at <= headerHeight) return { hidden: false, lastY: at };
  const delta = at - prev.lastY;
  if (Math.abs(delta) < SCROLL_UP_JITTER_PX) return prev;
  return { hidden: delta > 0, lastY: at };
}

/** A page scrolled further than this (px) has left the hero's top edge: the overlay header turns solid. */
export const OVERLAY_SOLID_AT_PX = 24;

/**
 * V7c-2 (V0 §9.3 point 2) — whether the overlay header is solid right now: past a small scroll threshold, or at
 * once while the shopper works inside it (focus within, an expanded menu / search, a dialog locking the page).
 * Pure so the storefront controller and the Canvas simulator share one rule.
 */
export function overlayIsSolid(y: number, pinned: boolean): boolean {
  return pinned || Math.max(0, y) > OVERLAY_SOLID_AT_PX;
}
