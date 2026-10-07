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
 *  - `background.kind = "media"` (+ overlay, mobile override) → V6, together with the
 *    region-luminance evidence the contrast gate needs (V0 §3.2.1);
 *  - `layout` variants → the slices that add variants (V6/V8/V9);
 *  - `separator` / `overlap` / `mediaTreatment` / `motion` → V5e / V6 / V8.
 * Until then they are dropped fail-closed, so a hand-written document can never
 * smuggle an unproven background past the publish gate.
 */

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

export type Step = (typeof STEPS)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type Align = (typeof ALIGNS)[number];
export type ColorRef = { role: PaletteRole } | { hex: string };

export type SectionBackground =
  | { kind: "solid"; color: ColorRef }
  | { kind: "gradient"; from: ColorRef; to: ColorRef; direction: Direction };

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

export interface SectionDesign {
  background?: SectionBackground;
  text?: SectionText;
  typography?: SectionTypography;
  width?: SectionWidth;
  spacing?: SectionSpacing;
  align?: Align;
  border?: SectionBorder;
  radius?: (typeof RADII)[number];
  shadow?: (typeof SHADOWS)[number];
}

export type DesignGroup = keyof SectionDesign;

/**
 * Per-type capability registry (V0 §3.4, authoritative). A group maps to the list of
 * fields the type may use inside it (`true` = the whole group). A section never
 * exposes a group it cannot render.
 */
type GroupAllowance = true | readonly string[];
export type DesignCapability = Partial<Record<DesignGroup, GroupAllowance>>;

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
    background: true,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: true,
    spacing: true,
    align: true,
    border: true,
    radius: true,
    shadow: true,
  },
  banner: {
    background: true,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: true,
    spacing: true,
    align: true,
    border: true,
    radius: true,
    shadow: true,
  },
  categories: {
    background: true,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    border: true,
    radius: true,
  },
  newArrivals: {
    background: true,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
  },
  featured: {
    background: true,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
  },
  offers: {
    background: true,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
  },
  productShelf: {
    background: true,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
  },
  discovery: { background: true, text: ["heading"], spacing: true },
  benefits: {
    background: true,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    spacing: true,
    align: true,
    border: true,
    radius: true,
    shadow: true,
  },
  customContent: {
    background: true,
    text: FULL_TEXT,
    typography: FULL_TYPO,
    width: ["max"],
    spacing: true,
    align: true,
  },
  appPromo: {
    background: true,
    text: FULL_TEXT,
    spacing: true,
    border: true,
    radius: true,
  },
  deliveryPromise: { background: true, spacing: true },
  wholesale: { background: true, spacing: true },
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

function normalizeBackground(raw: unknown): SectionBackground | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.kind === "solid") {
    const color = normalizeColorRef(raw.color);
    return color ? { kind: "solid", color } : undefined;
  }
  if (raw.kind === "gradient") {
    const from = normalizeColorRef(raw.from);
    const to = normalizeColorRef(raw.to);
    const direction = pick(raw.direction, DIRECTIONS);
    return from && to && direction
      ? { kind: "gradient", from, to, direction }
      : undefined;
  }
  return undefined; // `media` (and anything else) enters with V6 — fail-closed
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
    const background = normalizeBackground(raw.background);
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

  return Object.keys(out).length > 0 ? out : undefined;
}
