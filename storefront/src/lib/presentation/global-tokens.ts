/**
 * CUST-HV V5e-2a — document-level global tokens (contract: docs/plans/store/CUST-HV-V0-
 * DECISIONS-AND-ARCHITECTURE-CONTRACT.md §5.1 typography, §6.2 surfaces, §6.3 content
 * width, §6.6 motion).
 *
 * Four optional, additive keys — `typography`, `surfaces`, `layout`, `motion` — each a
 * typed, enumerated object, never a style bag. An invalid value is dropped on its own,
 * an empty group is omitted, and **absent keys ⇒ the storefront renders byte-identically
 * to before** (§2.2). `PRESENTATION_CONFIG_VERSION` stays 3.
 *
 * Twin of `web/.../presentation/global-tokens.ts` (byte-identical, test-enforced) and of
 * PHP `App\Support\Commerce\StorefrontGlobalTokensNormalizer` (the authority); all three
 * are pinned by `tests/Fixtures/presentation/global-tokens.json`.
 *
 * V5e-2b adds `buttons` and `typography.buttonText`. Their label contrast is proven by
 * construction (solid / soft compute the label over their own fill) or gated at publish
 * (`buttonContrastIssues` for outline / link — twin of PHP `ButtonTokensContrast`).
 *
 * Deliberately NOT here yet: font families (V5e-2c, a self-hosted catalogue), a surface
 * border colour, an icon on the button and per-CTA overrides (they belong to the slices that
 * own those CTAs — V6 hero/banner, V8 slider, V7 header). Dropped fail-closed until then.
 *
 * `resolveGlobalTokens` is the one pure function from the document to what a renderer puts
 * on the theme wrapper: a `data-gt` token list plus validated `--gt-*` custom properties.
 * No string from the document is ever interpolated into CSS.
 */

import {
  autoForeground,
  parseHex,
  passes,
  type Rgb,
  solidInterval,
  worstRatioForHex,
} from "./contrast-engine";
import { type PresentationPalette, resolveRoleHex } from "./palette";
import { mixHex } from "./tokens";

export const GLOBAL_HEADING_SCALES = ["sm", "md", "lg"] as const;
export const GLOBAL_BODY_SCALES = ["sm", "md", "lg"] as const;
export const GLOBAL_HEADING_WEIGHTS = [400, 500, 700, 800] as const;
export const GLOBAL_BODY_WEIGHTS = [400, 500, 700] as const;
export const GLOBAL_LINE_HEIGHTS = ["tight", "normal", "relaxed"] as const;
export const GLOBAL_SECTION_HEADINGS = [
  "bar",
  "plain",
  "centered",
  "underline",
] as const;
export const GLOBAL_BUTTON_STYLES = [
  "solid",
  "soft",
  "outline",
  "link",
] as const;
export const GLOBAL_BUTTON_SIZES = ["sm", "md", "lg"] as const;
export const GLOBAL_BUTTON_COLOURS = ["brand", "accent", "text"] as const;
export const GLOBAL_BUTTON_HOVERS = [
  "darken",
  "lift",
  "underline",
  "none",
] as const;
export const GLOBAL_BUTTON_TEXT_WEIGHTS = [500, 700, 800] as const;
export const GLOBAL_BUTTON_TEXT_CASES = ["normal", "upper"] as const;
export const GLOBAL_RADII = ["none", "sm", "md", "lg", "pill"] as const;
export const GLOBAL_BORDER_WIDTHS = ["none", "hairline", "medium"] as const;
export const GLOBAL_SHADOWS = ["none", "soft", "medium", "strong"] as const;
export const GLOBAL_CONTENT_WIDTHS = ["narrow", "standard", "wide"] as const;
export const GLOBAL_DURATIONS = ["instant", "fast", "base", "slow"] as const;
export const GLOBAL_EASINGS = ["standard", "emphasized"] as const;

export interface GlobalTypography {
  headingScale?: (typeof GLOBAL_HEADING_SCALES)[number];
  bodyScale?: (typeof GLOBAL_BODY_SCALES)[number];
  headingWeight?: (typeof GLOBAL_HEADING_WEIGHTS)[number];
  bodyWeight?: (typeof GLOBAL_BODY_WEIGHTS)[number];
  lineHeight?: (typeof GLOBAL_LINE_HEIGHTS)[number];
  sectionHeading?: (typeof GLOBAL_SECTION_HEADINGS)[number];
  buttonText?: {
    weight?: (typeof GLOBAL_BUTTON_TEXT_WEIGHTS)[number];
    case?: (typeof GLOBAL_BUTTON_TEXT_CASES)[number];
  };
}

export interface GlobalButtons {
  style?: (typeof GLOBAL_BUTTON_STYLES)[number];
  size?: (typeof GLOBAL_BUTTON_SIZES)[number];
  radius?: (typeof GLOBAL_RADII)[number];
  colour?: (typeof GLOBAL_BUTTON_COLOURS)[number];
  hover?: (typeof GLOBAL_BUTTON_HOVERS)[number];
}

export interface GlobalSurfaces {
  radius?: (typeof GLOBAL_RADII)[number];
  border?: { width: (typeof GLOBAL_BORDER_WIDTHS)[number] };
  shadow?: (typeof GLOBAL_SHADOWS)[number];
}

export interface GlobalLayout {
  contentWidth?: (typeof GLOBAL_CONTENT_WIDTHS)[number];
}

export interface GlobalMotion {
  duration?: (typeof GLOBAL_DURATIONS)[number];
  easing?: (typeof GLOBAL_EASINGS)[number];
}

export interface GlobalTokensDoc {
  typography?: GlobalTypography;
  buttons?: GlobalButtons;
  surfaces?: GlobalSurfaces;
  layout?: GlobalLayout;
  motion?: GlobalMotion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function pickFields(
  raw: unknown,
  fields: ReadonlyArray<readonly [string, readonly (string | number)[]]>,
): Record<string, string | number> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [field, allowed] of fields) {
    const value = pick(raw[field], allowed);
    if (value !== undefined) out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalises the four global-token keys of a raw presentation document. Returns only the
 * keys that survive, in a fixed canonical order (typography, surfaces, layout, motion).
 */
export function normalizeGlobalTokens(
  raw: Record<string, unknown>,
): GlobalTokensDoc {
  const out: GlobalTokensDoc = {};

  const typography = pickFields(raw.typography, [
    ["headingScale", GLOBAL_HEADING_SCALES],
    ["bodyScale", GLOBAL_BODY_SCALES],
    ["headingWeight", GLOBAL_HEADING_WEIGHTS],
    ["bodyWeight", GLOBAL_BODY_WEIGHTS],
    ["lineHeight", GLOBAL_LINE_HEIGHTS],
    ["sectionHeading", GLOBAL_SECTION_HEADINGS],
  ]);
  const buttonText = isRecord(raw.typography)
    ? pickFields(raw.typography.buttonText, [
        ["weight", GLOBAL_BUTTON_TEXT_WEIGHTS],
        ["case", GLOBAL_BUTTON_TEXT_CASES],
      ])
    : undefined;
  if (typography || buttonText) {
    out.typography = {
      ...(typography ?? {}),
      ...(buttonText ? { buttonText } : {}),
    } as GlobalTypography;
  }

  const buttons = pickFields(raw.buttons, [
    ["style", GLOBAL_BUTTON_STYLES],
    ["size", GLOBAL_BUTTON_SIZES],
    ["radius", GLOBAL_RADII],
    ["colour", GLOBAL_BUTTON_COLOURS],
    ["hover", GLOBAL_BUTTON_HOVERS],
  ]);
  if (buttons) out.buttons = buttons as GlobalButtons;

  const surfaceRaw = raw.surfaces;
  const radiusAndShadow = pickFields(surfaceRaw, [
    ["radius", GLOBAL_RADII],
    ["shadow", GLOBAL_SHADOWS],
  ]);
  const borderWidth =
    isRecord(surfaceRaw) && isRecord(surfaceRaw.border)
      ? pick(surfaceRaw.border.width, GLOBAL_BORDER_WIDTHS)
      : undefined;
  if (radiusAndShadow || borderWidth) {
    const surfaces: GlobalSurfaces = {};
    if (radiusAndShadow?.radius)
      surfaces.radius = radiusAndShadow.radius as GlobalSurfaces["radius"];
    if (borderWidth) surfaces.border = { width: borderWidth };
    if (radiusAndShadow?.shadow)
      surfaces.shadow = radiusAndShadow.shadow as GlobalSurfaces["shadow"];
    out.surfaces = surfaces;
  }

  const layout = pickFields(raw.layout, [
    ["contentWidth", GLOBAL_CONTENT_WIDTHS],
  ]);
  if (layout) out.layout = layout as GlobalLayout;

  const motion = pickFields(raw.motion, [
    ["duration", GLOBAL_DURATIONS],
    ["easing", GLOBAL_EASINGS],
  ]);
  if (motion) out.motion = motion as GlobalMotion;

  return out;
}

/** Named steps only — never a pixel input (V0 §5.2). `md` is today's size and emits nothing. */
const HEADING_ZOOM: Record<string, string> = { sm: "0.9", lg: "1.125" };
const BODY_ZOOM: Record<string, string> = { sm: "0.94", lg: "1.06" };
const LINE_HEIGHT: Record<string, string> = {
  tight: "1.3",
  normal: "1.5",
  relaxed: "1.75",
};
const RADIUS: Record<string, string> = {
  none: "0px",
  sm: "0.375rem",
  md: "0.75rem",
  lg: "1.25rem",
  // A card is not a capsule: the largest step stays a soft, bounded curve.
  pill: "1.75rem",
};
const BORDER_WIDTH: Record<string, string> = { none: "0px", medium: "2px" };
const SHADOW: Record<string, string> = {
  none: "none",
  soft: "0 1px 3px rgba(17, 24, 39, 0.10), 0 1px 2px rgba(17, 24, 39, 0.06)",
  medium: "0 6px 16px rgba(17, 24, 39, 0.12), 0 2px 4px rgba(17, 24, 39, 0.08)",
  strong:
    "0 18px 40px rgba(17, 24, 39, 0.20), 0 4px 8px rgba(17, 24, 39, 0.10)",
};
const CONTENT_MAX: Record<string, string> = {
  narrow: "64rem",
  wide: "100rem",
};
const DURATION: Record<string, string> = {
  instant: "0ms",
  fast: "150ms",
  base: "300ms",
  slow: "500ms",
};
const EASING: Record<string, string> = {
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  emphasized: "cubic-bezier(0.2, 0, 0, 1)",
};

/** The colours the button tokens resolve against (the document's own palette inputs). */
export interface ButtonContext {
  primaryColor: string;
  accentColor: string | null;
  palette?: PresentationPalette;
}

const BUTTON_RADIUS: Record<string, string> = {
  none: "0px",
  sm: "0.375rem",
  md: "0.75rem",
  lg: "1.25rem",
  pill: "9999px",
};
/** Padding + type steps of the sm / lg button sizes; `md` is today's size and emits nothing. */
const BUTTON_SIZE: Record<string, { py: string; px: string; fs: string }> = {
  sm: { py: "0.375rem", px: "0.75rem", fs: "0.75rem" },
  lg: { py: "0.875rem", px: "1.5rem", fs: "1rem" },
};
/** Same fixed backdrops as PHP `ButtonTokensContrast::BACKDROPS`: page background, card surface. */
export const BUTTON_BACKDROPS = ["#f8f9fa", "#ffffff"] as const;

function isHex(value: string): boolean {
  return parseHex(value) !== null;
}

/** `preferred` when it clears 4.5:1 over `fill`, otherwise the proven white / black. */
function labelOver(fill: string, preferred: string | null): string {
  const interval = solidInterval(parseHex(fill) as Rgb);
  if (preferred && passes(worstRatioForHex(preferred, interval)))
    return preferred;
  return autoForeground(interval);
}

export interface ButtonColours {
  fill: string;
  label: string;
  border: string;
  hoverFill: string;
  hoverLabel: string;
  hoverBorder: string;
}

/**
 * The fill / label / border of a primary button in each state, from the role colour `c`.
 * solid and soft compute their label over their own fill, so they pass by construction; outline
 * and link label with `c` itself (gated at publish — see `buttonContrastIssues`).
 */
export function buttonColours(
  style: NonNullable<GlobalButtons["style"]>,
  c: string,
  hover: NonNullable<GlobalButtons["hover"]>,
): ButtonColours {
  let base: Pick<ButtonColours, "fill" | "label" | "border">;
  let darkened: Pick<ButtonColours, "fill" | "label" | "border">;
  switch (style) {
    case "solid": {
      base = { fill: c, label: labelOver(c, null), border: c };
      const f = mixHex(c, "#000000", 0.32); // today's hover (`--store-primary-hover`)
      darkened = { fill: f, label: labelOver(f, null), border: f };
      break;
    }
    case "soft": {
      const f = mixHex(c, "#ffffff", 0.88);
      base = { fill: f, label: labelOver(f, c), border: f };
      const h = mixHex(c, "#ffffff", 0.78);
      darkened = { fill: h, label: labelOver(h, c), border: h };
      break;
    }
    case "outline": {
      base = { fill: "transparent", label: c, border: c };
      const h = mixHex(c, "#ffffff", 0.9);
      darkened = { fill: h, label: labelOver(h, c), border: c };
      break;
    }
    default: {
      base = { fill: "transparent", label: c, border: "transparent" };
      darkened = base;
    }
  }
  const hov = hover === "darken" ? darkened : base;
  return {
    ...base,
    hoverFill: hov.fill,
    hoverLabel: hov.label,
    hoverBorder: hov.border,
  };
}

/**
 * Issues the publish gate raises for the button label colour — twin of PHP
 * `ButtonTokensContrast::issues`. Only outline / link are judged (their label is the role colour
 * itself, over the page backdrops and any custom surface); solid / soft pass by construction.
 */
export function buttonContrastIssues(
  doc: GlobalTokensDoc | undefined,
  ctx: ButtonContext,
): Array<{ field: "colour"; code: "contrast_insufficient"; ratio: number }> {
  const buttons = doc?.buttons;
  if (!buttons || (buttons.style !== "outline" && buttons.style !== "link"))
    return [];
  const hex = resolveRoleHex(buttons.colour ?? "brand", ctx);
  if (!isHex(hex)) return [];
  const backdrops: string[] = [...BUTTON_BACKDROPS];
  const surface = ctx.palette?.surface;
  if (surface && isHex(surface)) backdrops.push(surface);
  let worst = Number.POSITIVE_INFINITY;
  for (const backdrop of backdrops) {
    worst = Math.min(
      worst,
      worstRatioForHex(hex, solidInterval(parseHex(backdrop) as Rgb)),
    );
  }
  return passes(worst)
    ? []
    : [
        {
          field: "colour",
          code: "contrast_insufficient",
          ratio: Math.round(worst * 10000) / 10000,
        },
      ];
}

export interface ResolvedGlobalTokens {
  /** `data-gt` (a space-separated token list) — absent when only plain variables are set. */
  attrs: Record<string, string>;
  style: Record<string, string>;
}

/**
 * The one pure function from the document's global tokens to the theme wrapper's
 * attributes and variables. `null` = nothing to apply (the wrapper is exactly as before).
 */
export function resolveGlobalTokens(
  doc: GlobalTokensDoc | undefined,
  ctx?: ButtonContext,
): ResolvedGlobalTokens | null {
  if (!doc) return null;
  const gt: string[] = [];
  const style: Record<string, string> = {};

  const ty = doc.typography;
  if (ty) {
    if (ty.headingScale && HEADING_ZOOM[ty.headingScale]) {
      style["--gt-hz"] = HEADING_ZOOM[ty.headingScale];
      gt.push("hz");
    }
    if (ty.bodyScale && BODY_ZOOM[ty.bodyScale]) {
      style["--gt-bz"] = BODY_ZOOM[ty.bodyScale];
      gt.push("bz");
    }
    if (ty.headingWeight) {
      style["--gt-hw"] = String(ty.headingWeight);
      gt.push("hw");
    }
    if (ty.bodyWeight) {
      style["--gt-bw"] = String(ty.bodyWeight);
      gt.push("bw");
    }
    if (ty.lineHeight) {
      style["--gt-lh"] = LINE_HEIGHT[ty.lineHeight];
      gt.push("lh");
    }
    // `bar` is the shared section heading's own look today, so it emits nothing.
    if (ty.sectionHeading && ty.sectionHeading !== "bar") {
      gt.push(`hs-${ty.sectionHeading}`);
    }
  }

  // buttons (V5e-2b) — sizes / radius / text apply to every button; style / colour / hover only to
  // primary buttons, and only when they actually differ from today (solid · brand · darken).
  const bt = doc.buttons;
  const btText = ty?.buttonText;
  if (bt?.size && BUTTON_SIZE[bt.size]) {
    const step = BUTTON_SIZE[bt.size];
    style["--gt-bpy"] = step.py;
    style["--gt-bpx"] = step.px;
    style["--gt-bfs"] = step.fs;
    gt.push("b-sz");
  }
  if (bt?.radius && BUTTON_RADIUS[bt.radius]) {
    style["--gt-brad"] = BUTTON_RADIUS[bt.radius];
    gt.push("b-rad");
  }
  if (btText?.weight) {
    style["--gt-bfw"] = String(btText.weight);
    gt.push("b-fw");
  }
  if (btText?.case === "upper") gt.push("b-up");
  const primaryChanged =
    bt &&
    ((bt.style && bt.style !== "solid") ||
      (bt.colour && bt.colour !== "brand") ||
      (bt.hover && bt.hover !== "darken"));
  if (bt && primaryChanged && ctx) {
    const base = resolveRoleHex(bt.colour ?? "brand", ctx);
    if (isHex(base)) {
      const btStyle = bt.style ?? "solid";
      const hover = bt.hover ?? (btStyle === "link" ? "underline" : "darken");
      const c = buttonColours(btStyle, base, hover);
      style["--gt-bf"] = c.fill;
      style["--gt-bl"] = c.label;
      style["--gt-bb"] = c.border;
      style["--gt-bhf"] = c.hoverFill;
      style["--gt-bhl"] = c.hoverLabel;
      style["--gt-bhb"] = c.hoverBorder;
      gt.push("b-pri");
      if (btStyle === "outline" || btStyle === "link")
        gt.push(`b-sty-${btStyle}`);
      if (hover === "lift" || hover === "underline") gt.push(`b-hv-${hover}`);
    }
  }

  const su = doc.surfaces;
  if (su) {
    if (su.radius) {
      style["--store-radius"] = RADIUS[su.radius];
      style["--radius"] = RADIUS[su.radius];
    }
    // `hairline` is today's 1 px card border, so it emits nothing.
    if (su.border && BORDER_WIDTH[su.border.width]) {
      style["--gt-sbw"] = BORDER_WIDTH[su.border.width];
      gt.push("sbw");
    }
    if (su.shadow) {
      style["--gt-shd"] = SHADOW[su.shadow];
      gt.push("shd");
    }
  }

  const width = doc.layout?.contentWidth;
  if (width && CONTENT_MAX[width]) {
    style["--store-content-max"] = CONTENT_MAX[width];
  }

  const mo = doc.motion;
  if (mo) {
    if (mo.duration) {
      style["--gt-md"] = DURATION[mo.duration];
      gt.push("mo-d");
    }
    if (mo.easing) {
      style["--gt-me"] = EASING[mo.easing];
      gt.push("mo-e");
    }
  }

  if (gt.length === 0 && Object.keys(style).length === 0) return null;
  return { attrs: gt.length > 0 ? { "data-gt": gt.join(" ") } : {}, style };
}
