/**
 * CUST-HV V5b — Section Visual Contract (contract: docs/plans/store/CUST-HV-V0-
 * DECISIONS-AND-ARCHITECTURE-CONTRACT.md §3.1–§3.4).
 *
 * `section.design` is a typed, enumerated object — never a style bag. Each section
 * type declares which groups (and which fields inside a group) it can render; an
 * unknown or disallowed group/field is dropped, an invalid value is dropped on its
 * own, and an empty result is omitted. **Absent `design` ⇒ the section renders
 * byte-identically to before** (§3.1).
 *
 * Twin of `storefront/src/lib/presentation/section-design.ts` (byte-identical) and of
 * PHP `App\Support\Commerce\StorefrontSectionDesignNormalizer` (the authority);
 * all three are pinned by `tests/Fixtures/presentation/section-design.json`.
 *
 * Deliberately NOT here yet (each enters with the slice that can render and prove it):
 *  - `layout` variants → the slices that add variants (V6/V8/V9);
 *  - `mediaTreatment.aspect` / `fit` → V8 (V6c-3 added `valign` and `mediaTreatment.height`).
 * Until then they are dropped fail-closed, so a hand-written document can never
 * smuggle an unproven background past the publish gate.
 */

import { type MediaRef, normalizeMediaRef } from "./media-ref";
import { PALETTE_ROLES, type PaletteRole } from "./palette";
import { isSafeHexColor } from "./tokens";

export const COLOR_ROLES: readonly PaletteRole[] = [
  "brand",
  "accent",
  ...PALETTE_ROLES,
];
export const STEPS = ["none", "xs", "sm", "md", "lg", "xl"] as const;
export const DIRECTIONS = [
  "to-end",
  "to-start",
  "to-bottom",
  "to-top",
  "to-bottom-end",
  "to-bottom-start",
  "to-top-end",
  "to-top-start",
] as const;
export const ALIGNS = ["start", "center", "end"] as const;
export const HEADING_SCALES = ["sm", "md", "lg", "xl"] as const;
export const BODY_SCALES = ["sm", "md", "lg"] as const;
export const HEADING_WEIGHTS = [400, 500, 700, 800] as const;
export const LINE_HEIGHTS = ["tight", "normal", "relaxed"] as const;
export const HEADING_STYLES = [
  "bar",
  "plain",
  "centered",
  "underline",
] as const;
export const WIDTH_MODES = ["contained", "wide", "full"] as const;
export const WIDTH_MAXES = ["narrow", "standard", "wide"] as const;
export const BORDER_WIDTHS = ["none", "hairline", "medium"] as const;
export const RADII = ["none", "sm", "md", "lg", "pill"] as const;
export const SHADOWS = ["none", "soft", "medium", "strong"] as const;
/** V5e-3 — section-edge separators (V0 §6.4) and the one-time reveal (V0 §6.6). */
export const SEPARATOR_KINDS = [
  "none",
  "line",
  "band",
  "wave",
  "angle",
  "curve",
] as const;
export const SEPARATOR_HEIGHTS = ["sm", "md", "lg"] as const;
export const REVEALS = ["none", "fade-up"] as const;
/** V6c-4 (V0 §6.5, D-13) — hero overlap presets; `none` is the absence of the field and is never stored. */
export const OVERLAPS = ["none", "sm", "md"] as const;
/** V6c-3 (V0 §8.3) — hero / banner section height presets: a bounded minimum, content is never clipped. */
export const HEIGHT_PRESETS = [
  "compact",
  "standard",
  "tall",
  "screen",
] as const;
/** V6b-2 — background kinds every section may use; `media` is hero/banner only. */
export const BACKGROUND_KINDS = ["solid", "gradient"] as const;
/** V6b-2 — media overlay opacity: percent in steps of 5, capped at 90 (the picture never vanishes). */
export const OVERLAY_ALPHAS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
] as const;

export type Step = (typeof STEPS)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type Align = (typeof ALIGNS)[number];
export type ColorRef = { role: PaletteRole } | { hex: string };

export interface MediaOverlay {
  color: ColorRef;
  alpha: (typeof OVERLAY_ALPHAS)[number];
}

export type SectionBackground =
  | { kind: "solid"; color: ColorRef }
  | { kind: "gradient"; from: ColorRef; to: ColorRef; direction: Direction }
  | {
      kind: "media";
      media: MediaRef;
      mobile?: MediaRef;
      overlay?: MediaOverlay;
    };

export interface SectionText {
  heading?: ColorRef;
  body?: ColorRef;
  link?: ColorRef;
  align?: Align;
}
export interface SectionTypography {
  headingScale?: (typeof HEADING_SCALES)[number];
  bodyScale?: (typeof BODY_SCALES)[number];
  headingWeight?: (typeof HEADING_WEIGHTS)[number];
  lineHeight?: (typeof LINE_HEIGHTS)[number];
  headingStyle?: (typeof HEADING_STYLES)[number];
}
export interface SectionWidth {
  mode?: (typeof WIDTH_MODES)[number];
  max?: (typeof WIDTH_MAXES)[number];
}
export interface SectionSpacing {
  top?: Step;
  bottom?: Step;
  inner?: Step;
}
export interface SectionBorder {
  width: (typeof BORDER_WIDTHS)[number];
  color?: ColorRef;
}

export interface SectionSeparator {
  top?: (typeof SEPARATOR_KINDS)[number];
  bottom?: (typeof SEPARATOR_KINDS)[number];
  color?: ColorRef;
  height?: (typeof SEPARATOR_HEIGHTS)[number];
}
export interface SectionMotion {
  reveal?: (typeof REVEALS)[number];
}

export interface SectionMediaTreatment {
  height?: (typeof HEIGHT_PRESETS)[number];
}

export interface SectionDesign {
  background?: SectionBackground;
  text?: SectionText;
  typography?: SectionTypography;
  width?: SectionWidth;
  spacing?: SectionSpacing;
  align?: Align;
  /** V6c-3 — the block-axis half of the 3×3 content position (`align` is the inline half). */
  valign?: Align;
  border?: SectionBorder;
  radius?: (typeof RADII)[number];
  shadow?: (typeof SHADOWS)[number];
  separator?: SectionSeparator;
  /** V6c-4 — hero only: the FOLLOWING section slides up over the hero's bottom edge (≥ md, picture heroes). */
  overlap?: Exclude<(typeof OVERLAPS)[number], "none">;
  mediaTreatment?: SectionMediaTreatment;
  motion?: SectionMotion;
}

export type DesignGroup = keyof SectionDesign;

/**
 * Per-type capability registry (V0 §3.4, authoritative). A group maps to the list of
 * fields the type may use inside it (`true` = the whole group). A section never
 * exposes a group it cannot render.
 */
type GroupAllowance = true | readonly string[];
export type DesignCapability = Partial<Record<DesignGroup, GroupAllowance>>;

const MEDIA_BACKGROUND = [...BACKGROUND_KINDS, "media"] as const;
const FULL_TEXT = ["heading", "body", "link", "align"] as const;
const FULL_TYPO = [
  "headingScale",
  "bodyScale",
  "headingWeight",
  "lineHeight",
  "headingStyle",
] as const;

export const SECTION_DESIGN_CAPABILITIES: Record<string, DesignCapability> = {
  hero: {
    background: MEDIA_BACKGROUND,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: true,
    spacing: true,
    align: true,
    valign: true,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
    overlap: true,
    mediaTreatment: ["height"],
    motion: ["reveal"],
  },
  banner: {
    background: MEDIA_BACKGROUND,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: true,
    spacing: true,
    align: true,
    valign: true,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
    mediaTreatment: ["height"],
    motion: ["reveal"],
  },
  categories: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    border: true,
    radius: true,
    separator: true,
  },
  newArrivals: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    separator: true,
  },
  featured: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    separator: true,
  },
  offers: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    separator: true,
  },
  productShelf: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    separator: true,
  },
  discovery: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    spacing: true,
    separator: true,
  },
  benefits: {
    background: BACKGROUND_KINDS,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    spacing: true,
    align: true,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
  },
  customContent: {
    background: BACKGROUND_KINDS,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: ["max"],
    spacing: true,
    align: true,
    separator: true,
  },
  appPromo: {
    background: BACKGROUND_KINDS,
    text: FULL_TEXT,
    spacing: true,
    border: true,
    radius: true,
    separator: true,
  },
  deliveryPromise: {
    background: BACKGROUND_KINDS,
    spacing: true,
    separator: true,
  },
  wholesale: {
    background: BACKGROUND_KINDS,
    spacing: true,
    separator: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/**
 * `{role}` wins over `{hex}` when both are present (deterministic); a hex is
 * canonicalised to lower case; anything else is dropped.
 */
export function normalizeColorRef(raw: unknown): ColorRef | undefined {
  if (!isRecord(raw)) return undefined;
  const role = pick(raw.role, COLOR_ROLES);
  if (role) return { role };
  const hex = typeof raw.hex === "string" ? raw.hex.trim() : "";
  if (isSafeHexColor(hex)) return { hex: hex.toLowerCase() };
  return undefined;
}

function allowsField(
  allowance: GroupAllowance | undefined,
  field: string,
): boolean {
  if (allowance === undefined) return false;
  return allowance === true || allowance.includes(field);
}

function normalizeBackground(
  raw: unknown,
  allowance: GroupAllowance | undefined,
): SectionBackground | undefined {
  if (!isRecord(raw)) return undefined;
  const kind = raw.kind;
  if (typeof kind !== "string" || !allowsField(allowance, kind)) {
    return undefined; // unknown or not allowed for this section — fail-closed
  }
  if (kind === "solid") {
    const color = normalizeColorRef(raw.color);
    return color ? { kind: "solid", color } : undefined;
  }
  if (kind === "gradient") {
    const from = normalizeColorRef(raw.from);
    const to = normalizeColorRef(raw.to);
    const direction = pick(raw.direction, DIRECTIONS);
    return from && to && direction
      ? { kind: "gradient", from, to, direction }
      : undefined;
  }
  if (kind === "media") return normalizeMediaBackground(raw);
  return undefined;
}

/**
 * V6b-2 — an image background: `media` is required (else the whole background drops),
 * `mobile` is an optional phone-width alternative, `overlay` an optional colour wash.
 * The picture is decorative by definition (no alt) and always `cover`: a frame that does
 * not fill the box would reveal a surface the contrast evidence does not cover.
 */
function normalizeBackgroundRef(raw: unknown): MediaRef | undefined {
  const ref = normalizeMediaRef(raw);
  if (!ref) return undefined;
  const { fit: _fit, alt: _alt, ...rest } = ref;
  return { ...rest, decorative: true };
}

function normalizeMediaOverlay(raw: unknown): MediaOverlay | undefined {
  if (!isRecord(raw)) return undefined;
  const alpha = pick(raw.alpha, OVERLAY_ALPHAS);
  if (alpha === undefined) return undefined;
  return { color: normalizeColorRef(raw.color) ?? { role: "overlay" }, alpha };
}

function normalizeMediaBackground(
  raw: Record<string, unknown>,
): SectionBackground | undefined {
  const media = normalizeBackgroundRef(raw.media);
  if (!media) return undefined;
  const out: SectionBackground = { kind: "media", media };
  const mobile = normalizeBackgroundRef(raw.mobile);
  if (mobile) out.mobile = mobile;
  const overlay = normalizeMediaOverlay(raw.overlay);
  if (overlay) out.overlay = overlay;
  return out;
}

function normalizeText(
  raw: unknown,
  allowance: GroupAllowance,
): SectionText | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionText = {};
  for (const key of ["heading", "body", "link"] as const) {
    if (!allowsField(allowance, key)) continue;
    const ref = normalizeColorRef(raw[key]);
    if (ref) out[key] = ref;
  }
  if (allowsField(allowance, "align")) {
    const align = pick(raw.align, ALIGNS);
    if (align) out.align = align;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeTypography(
  raw: unknown,
  allowance: GroupAllowance,
): SectionTypography | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionTypography = {};
  const headingScale = allowsField(allowance, "headingScale")
    ? pick(raw.headingScale, HEADING_SCALES)
    : undefined;
  if (headingScale) out.headingScale = headingScale;
  const bodyScale = allowsField(allowance, "bodyScale")
    ? pick(raw.bodyScale, BODY_SCALES)
    : undefined;
  if (bodyScale) out.bodyScale = bodyScale;
  const headingWeight = allowsField(allowance, "headingWeight")
    ? pick(raw.headingWeight, HEADING_WEIGHTS)
    : undefined;
  if (headingWeight) out.headingWeight = headingWeight;
  const lineHeight = allowsField(allowance, "lineHeight")
    ? pick(raw.lineHeight, LINE_HEIGHTS)
    : undefined;
  if (lineHeight) out.lineHeight = lineHeight;
  const headingStyle = allowsField(allowance, "headingStyle")
    ? pick(raw.headingStyle, HEADING_STYLES)
    : undefined;
  if (headingStyle) out.headingStyle = headingStyle;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeWidth(
  raw: unknown,
  allowance: GroupAllowance,
): SectionWidth | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionWidth = {};
  const mode = allowsField(allowance, "mode")
    ? pick(raw.mode, WIDTH_MODES)
    : undefined;
  if (mode) out.mode = mode;
  const max = allowsField(allowance, "max")
    ? pick(raw.max, WIDTH_MAXES)
    : undefined;
  if (max) out.max = max;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSpacing(raw: unknown): SectionSpacing | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionSpacing = {};
  for (const key of ["top", "bottom", "inner"] as const) {
    const step = pick(raw[key], STEPS);
    if (step) out[key] = step;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBorder(raw: unknown): SectionBorder | undefined {
  if (!isRecord(raw)) return undefined;
  const width = pick(raw.width, BORDER_WIDTHS);
  if (!width) return undefined;
  const out: SectionBorder = { width };
  const color = normalizeColorRef(raw.color);
  if (color && width !== "none") out.color = color;
  return out;
}

function normalizeSeparator(raw: unknown): SectionSeparator | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionSeparator = {};
  for (const edge of ["top", "bottom"] as const) {
    const kind = pick(raw[edge], SEPARATOR_KINDS);
    if (kind) out[edge] = kind;
  }
  // Colour and height only style an edge: without a top or bottom edge that renders they are inert,
  // invisible and uneditable metadata — the group is dropped altogether.
  if (
    !(out.top && out.top !== "none") &&
    !(out.bottom && out.bottom !== "none")
  ) {
    return undefined;
  }
  const color = normalizeColorRef(raw.color);
  if (color) out.color = color;
  const height = pick(raw.height, SEPARATOR_HEIGHTS);
  if (height) out.height = height;
  return out;
}

/**
 * Lenient + deterministic. `undefined` = no design (the key is then omitted from the
 * section, so documents without design stay byte-identical).
 */
export function normalizeSectionDesign(
  type: string,
  raw: unknown,
): SectionDesign | undefined {
  const capability = SECTION_DESIGN_CAPABILITIES[type];
  if (!capability || !isRecord(raw)) return undefined;
  const out: SectionDesign = {};

  if (capability.background) {
    const background = normalizeBackground(
      raw.background,
      capability.background,
    );
    if (background) out.background = background;
  }
  if (capability.text) {
    const text = normalizeText(raw.text, capability.text);
    if (text) out.text = text;
  }
  if (capability.typography) {
    const typography = normalizeTypography(
      raw.typography,
      capability.typography,
    );
    if (typography) out.typography = typography;
  }
  if (capability.width) {
    const width = normalizeWidth(
      raw.width,
      capability.width === true ? ["mode", "max"] : capability.width,
    );
    if (width) out.width = width;
  }
  if (capability.spacing) {
    const spacing = normalizeSpacing(raw.spacing);
    if (spacing) out.spacing = spacing;
  }
  if (capability.align) {
    const align = pick(raw.align, ALIGNS);
    if (align) out.align = align;
  }
  if (capability.valign) {
    const valign = pick(raw.valign, ALIGNS);
    if (valign) out.valign = valign;
  }
  if (capability.border) {
    const border = normalizeBorder(raw.border);
    if (border) out.border = border;
  }
  if (capability.radius) {
    const radius = pick(raw.radius, RADII);
    if (radius) out.radius = radius;
  }
  if (capability.shadow) {
    const shadow = pick(raw.shadow, SHADOWS);
    if (shadow) out.shadow = shadow;
  }
  if (capability.separator) {
    const separator = normalizeSeparator(raw.separator);
    if (separator) out.separator = separator;
  }
  if (capability.overlap) {
    const overlap = pick(raw.overlap, OVERLAPS);
    // `none` is the same as absent: the default is never stored.
    if (overlap && overlap !== "none") out.overlap = overlap;
  }
  if (
    capability.mediaTreatment &&
    isRecord(raw.mediaTreatment) &&
    allowsField(capability.mediaTreatment, "height")
  ) {
    const height = pick(raw.mediaTreatment.height, HEIGHT_PRESETS);
    if (height) out.mediaTreatment = { height };
  }
  if (capability.motion && isRecord(raw.motion)) {
    const reveal = pick(raw.motion.reveal, REVEALS);
    if (reveal) out.motion = { reveal };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
