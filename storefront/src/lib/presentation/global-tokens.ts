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
 * Deliberately NOT here yet: font families (V5e-2c, a self-hosted catalogue), `buttons` /
 * `buttonText` (V5e-2b — they need the label-contrast proof) and a border colour. They are
 * dropped fail-closed until the slice that can render and prove them.
 *
 * `resolveGlobalTokens` is the one pure function from the document to what a renderer puts
 * on the theme wrapper: a `data-gt` token list plus validated `--gt-*` custom properties.
 * No string from the document is ever interpolated into CSS.
 */

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
  if (typography) out.typography = typography as GlobalTypography;

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
