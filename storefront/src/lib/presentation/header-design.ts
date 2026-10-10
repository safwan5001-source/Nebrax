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
 * V7a is structural only — no colours, so there is no contrast to prove here: `layout`,
 * `mobileLayout`, `height`, `logo.size`, `sticky` (`always | off`), `border.width`, `shadow`.
 * Deliberately NOT here yet (dropped fail-closed until their slice): `surface` / `text` / `icon`
 * colours (V7b, behind a contrast gate), `sticky: on-scroll-up` and `mode` (V7c), explicit
 * `search` / `categoryNav` presentation, `logo.align` / `logo.treatment`.
 *
 * `resolveHeaderDesign` is the one pure function from the document to what a renderer needs: a
 * `data-hd` token list for the theme wrapper (heights, sticky offset, borders, shadow — CSS in
 * `globals.css`) and the validated structural choices the `Header` component maps onto literal
 * class names. No string from the document is ever interpolated into CSS or a class.
 */

export const HEADER_LAYOUTS = [
  "standard",
  "compact",
  "centered",
  "two-row",
] as const;
export const HEADER_MOBILE_LAYOUTS = ["logo-centre", "logo-start"] as const;
export const HEADER_HEIGHTS = ["compact", "standard", "tall"] as const;
export const HEADER_LOGO_SIZES = ["sm", "md", "lg", "xl"] as const;
export const HEADER_STICKY = ["always", "off"] as const;
export const HEADER_BORDER_WIDTHS = ["none", "hairline", "medium"] as const;
export const HEADER_SHADOWS = ["none", "soft", "medium"] as const;

export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];
export type HeaderMobileLayout = (typeof HEADER_MOBILE_LAYOUTS)[number];
export type HeaderHeight = (typeof HEADER_HEIGHTS)[number];
export type HeaderLogoSize = (typeof HEADER_LOGO_SIZES)[number];
export type HeaderSticky = (typeof HEADER_STICKY)[number];
export type HeaderBorderWidth = (typeof HEADER_BORDER_WIDTHS)[number];
export type HeaderShadow = (typeof HEADER_SHADOWS)[number];

export interface HeaderDesign {
  layout?: HeaderLayout;
  mobileLayout?: HeaderMobileLayout;
  height?: HeaderHeight;
  logo?: { size: HeaderLogoSize };
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

export interface ResolvedHeaderDesign {
  /** `data-hd` token list for the theme wrapper; undefined ⇒ no attribute at all. */
  attrs?: { "data-hd": string };
  layout: "standard" | "centered" | "two-row";
  mobileLayout: HeaderMobileLayout;
  logoSize: HeaderLogoSize | undefined;
  sticky: HeaderSticky;
  /** True when any structural choice is set — the identity row then sizes with `min-h`. */
  designed: boolean;
}

/**
 * Token legend (the CSS lives in `globals.css`, block "CUST-HV V7a — header design"):
 * `hh-c` / `hh-t` compact / tall height · `hl-2` two-row (taller sticky offset) ·
 * `hs-o` sticky off (offset collapses to the announcement bar) · `hb-n` / `hb-m` no / medium
 * border · `hx-s` / `hx-m` soft / medium shadow. Defaults (`standard`, `always`, `hairline`,
 * `none`) emit no token — they are the rendering that already exists.
 */
export function resolveHeaderDesign(
  design: HeaderDesign | undefined,
): ResolvedHeaderDesign {
  const tokens: string[] = [];
  if (design?.height === "compact") tokens.push("hh-c");
  if (design?.height === "tall") tokens.push("hh-t");
  if (design?.layout === "two-row") tokens.push("hl-2");
  if (design?.sticky === "off") tokens.push("hs-o");
  if (design?.border?.width === "none") tokens.push("hb-n");
  if (design?.border?.width === "medium") tokens.push("hb-m");
  if (design?.shadow === "soft") tokens.push("hx-s");
  if (design?.shadow === "medium") tokens.push("hx-m");

  return {
    ...(tokens.length > 0 ? { attrs: { "data-hd": tokens.join(" ") } } : {}),
    layout: headerDesktopLayout(design),
    mobileLayout: design?.mobileLayout ?? "logo-centre",
    logoSize: design?.logo?.size,
    sticky: design?.sticky ?? "always",
    designed: design !== undefined,
  };
}
