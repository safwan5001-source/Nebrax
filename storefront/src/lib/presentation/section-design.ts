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
 *  - `layout` variants of the other types → the slices that add them (V8/V9; V6c-7 added hero and banner);
 *  - `mediaTreatment.aspect` / `fit` → V8 (V6c-3 added `valign` and `mediaTreatment.height`).
 * Until then they are dropped fail-closed, so a hand-written document can never
 * smuggle an unproven background past the publish gate.
 */

import { type GlobalCards, normalizeGlobalCards } from "./global-tokens";
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
/**
 * V6c-7 (V0 §3.4) — layout variants per type: a closed list, the default (hero: text over the image; banner: card) is the
 * ABSENCE of the field and is never stored. A banner's `full-bleed` is not a variant: `width.mode = full` (V5) says the same.
 */
export const LAYOUTS = {
  hero: ["centered", "split", "minimal"],
  banner: ["split", "text-band"],
  // CUST-HV V8d (V0 §3.4, D-24) — the gallery is a grid by default (absence); only `carousel` is stored.
  gallery: ["carousel"],
  // CUST-HV V9b (V0 §3.4) — benefits: cards in automatic columns is the default (absence); `flat` drops the card frame,
  // `columns-N` fixes the wide-screen column count (phones are always one column, tablets two).
  benefits: ["flat", "columns-2", "columns-3", "columns-4"],
  // CUST-HV V9d-2 (V0 §14.2) — product shelves: absence = the theme's own form (a grid in Modern, a rail in Market), so both values
  // are stored. Offers have no rail (no offer carousel exists) and therefore no `layout`.
  shelf: ["grid", "rail"],
} as const;
/** CUST-HV V9d-2 — the wide-screen column count of a product / offer shelf (phones are always two). */
export const SHELF_COLUMNS = [2, 3, 4] as const;
export type ShelfColumns = (typeof SHELF_COLUMNS)[number];
export type HeroLayout = (typeof LAYOUTS.hero)[number];
export type BannerLayout = (typeof LAYOUTS.banner)[number];
export type GalleryLayout = (typeof LAYOUTS.gallery)[number];
export type BenefitsLayout = (typeof LAYOUTS.benefits)[number];
export type ShelfLayout = (typeof LAYOUTS.shelf)[number];

/** V6c-4 (V0 §6.5, D-13) — hero overlap presets; `none` is the absence of the field and is never stored. */
export const OVERLAPS = ["none", "sm", "md"] as const;
/** V6c-3 (V0 §8.3) — hero / banner section height presets: a bounded minimum, content is never clipped. */
export const HEIGHT_PRESETS = [
  "compact",
  "standard",
  "tall",
  "screen",
] as const;
/**
 * AWJ-HERO-FULLBLEED — hero-only `mediaTreatment` fields beyond `height`: `mobileHeight` (a preset that overrides `height` below
 * 768 px), `ratio: natural` (the hero's height follows its picture's own proportions at the section width — nothing cropped,
 * nothing distorted, so the contrast evidence still covers every pixel) and `bleed: true` (the picture reaches both viewport
 * edges). Absent = the default (preset height, contained card). `contain` is deliberately not offered: a frame that does not
 * fill the box would reveal a surface the contrast evidence does not cover (see `normalizeBackgroundRef`).
 */
export const MEDIA_RATIOS = ["natural"] as const;
/** The hero's `mediaTreatment` fields, in canonical output order. */
export const HERO_MEDIA_TREATMENT = [
  "height",
  "mobileHeight",
  "ratio",
  "bleed",
] as const;
/** V6b-2 — background kinds every section may use; `media` is hero/banner only. */
export const BACKGROUND_KINDS = ["solid", "gradient"] as const;
/** V6b-2 — media overlay opacity: percent in steps of 5, capped at 90 (the picture never vanishes). */
export const OVERLAY_ALPHAS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
] as const;

/**
 * AWJ-STORE-CAT-DESIGN-01 — `design.display`, the `categories` section's card display (layout, card, image, name, responsive).
 * **Absent ⇒ the classic tile exactly as before**; `layout` is the group's gate (without it the whole group is dropped, so no
 * inert metadata survives). Integers follow the `productShelf.limit` / VD-4a rule: an integral number is clamped into its
 * range, anything else drops the key (saving never rejects content). Card colours are the store theme's own tokens, never a
 * free hex, so no contrast gate is needed. Twin of the PHP `display()` helper; pinned by `section-design.json`.
 */
export const DISPLAY_LAYOUTS = [
  "grid",
  "horizontal_scroll",
  "circles",
  "image_tiles",
  "compact_list",
] as const;
export type DisplayLayout = (typeof DISPLAY_LAYOUTS)[number];
export const DISPLAY_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type DisplayDevice = (typeof DISPLAY_DEVICES)[number];
/** device => [min, max]. */
export const DISPLAY_COLUMN_RANGES: Record<
  DisplayDevice,
  readonly [number, number]
> = {
  mobile: [1, 4],
  tablet: [2, 6],
  desktop: [2, 8],
};
export const DISPLAY_GAP_RANGE = [4, 32] as const;
export const DISPLAY_ITEM_WIDTH_RANGE = [64, 320] as const;
export const DISPLAY_CARD_STYLES = [
  "none",
  "border",
  "shadow",
  "filled",
] as const;
export const DISPLAY_CARD_BACKGROUNDS = [
  "surface",
  "muted",
  "transparent",
] as const;
export const DISPLAY_CARD_BORDER_COLORS = [
  "border",
  "strong",
  "primary",
  "accent",
] as const;
export const DISPLAY_CARD_BORDER_WIDTH_RANGE = [0, 4] as const;
export const DISPLAY_CARD_RADIUS_RANGE = [0, 32] as const;
export const DISPLAY_CARD_PADDING_RANGE = [0, 32] as const;
export const DISPLAY_CARD_HOVERS = ["none", "subtle"] as const;
export const DISPLAY_IMAGE_SHAPES = ["rect", "square", "circle"] as const;
export const DISPLAY_IMAGE_ASPECTS = ["1:1", "4:3", "3:2", "16:9"] as const;
export const DISPLAY_IMAGE_FITS = ["cover", "contain"] as const;
export const DISPLAY_IMAGE_POSITIONS = [
  "center",
  "top",
  "bottom",
  "start",
  "end",
] as const;
export const DISPLAY_IMAGE_HEIGHT_RANGE = [48, 400] as const;
export const DISPLAY_NAME_PLACEMENTS = [
  "below",
  "above",
  "overlay",
  "beside",
] as const;
export const DISPLAY_NAME_SIZE_RANGE = [12, 32] as const;
export const DISPLAY_NAME_WEIGHTS = [400, 500, 600, 700, 800] as const;
export const DISPLAY_NAME_COLORS = ["foreground", "muted", "primary"] as const;
export const DISPLAY_NAME_LINES = [1, 2, "natural"] as const;
export const DISPLAY_NAME_BACKGROUNDS = ["none", "scrim", "surface"] as const;

export type PerDevice = Partial<Record<DisplayDevice, number>>;

export interface DisplayCard {
  style?: (typeof DISPLAY_CARD_STYLES)[number];
  background?: (typeof DISPLAY_CARD_BACKGROUNDS)[number];
  borderColor?: (typeof DISPLAY_CARD_BORDER_COLORS)[number];
  borderWidth?: number;
  radius?: number;
  padding?: number;
  hover?: (typeof DISPLAY_CARD_HOVERS)[number];
}
export interface DisplayImage {
  /** Only ever stored as `false` (visible is the default). */
  show?: false;
  shape?: (typeof DISPLAY_IMAGE_SHAPES)[number];
  aspect?: (typeof DISPLAY_IMAGE_ASPECTS)[number];
  fit?: (typeof DISPLAY_IMAGE_FITS)[number];
  position?: (typeof DISPLAY_IMAGE_POSITIONS)[number];
  /** Present = a bounded custom height per device; absent = automatic (the aspect ratio decides). */
  height?: PerDevice;
}
export interface DisplayName {
  /** Only ever stored as `false` (visible is the default). */
  show?: false;
  placement?: (typeof DISPLAY_NAME_PLACEMENTS)[number];
  align?: Align;
  size?: number;
  weight?: (typeof DISPLAY_NAME_WEIGHTS)[number];
  color?: (typeof DISPLAY_NAME_COLORS)[number];
  lines?: (typeof DISPLAY_NAME_LINES)[number];
  background?: (typeof DISPLAY_NAME_BACKGROUNDS)[number];
}
export interface CategoryDisplay {
  layout: DisplayLayout;
  columns?: PerDevice;
  gap?: PerDevice;
  itemWidth?: PerDevice;
  card?: DisplayCard;
  image?: DisplayImage;
  name?: DisplayName;
}

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
  /** AWJ-HERO-FULLBLEED — hero only: overrides `height` below 768 px. */
  mobileHeight?: (typeof HEIGHT_PRESETS)[number];
  /** AWJ-HERO-FULLBLEED — hero only: the height follows the picture's own proportions. */
  ratio?: (typeof MEDIA_RATIOS)[number];
  /** AWJ-HERO-FULLBLEED — hero only, stored only as `true`: the picture reaches both viewport edges. */
  bleed?: true;
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
  /** V6c-7 — hero: `centered` | `split` | `minimal`; banner: `split` | `text-band`. Absent = the default layout. */
  layout?:
    | HeroLayout
    | BannerLayout
    | GalleryLayout
    | BenefitsLayout
    | ShelfLayout;
  /** CUST-HV V9d-2 — product / offer shelves: the wide-screen column count (2 | 3 | 4). Absent = today's. */
  columns?: ShelfColumns;
  border?: SectionBorder;
  radius?: (typeof RADII)[number];
  shadow?: (typeof SHADOWS)[number];
  /** CUST-HV V9d-2 (V0 §14.1) — product / offer shelves: this section's own card tokens, winning over the document's. */
  cards?: GlobalCards;
  /** AWJ-STORE-CAT-DESIGN-01 — `categories` only: the card display (layout, card, image, name, responsive). Absent = the classic tile. */
  display?: CategoryDisplay;
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
type GroupAllowance = true | readonly (string | number)[];
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
    layout: LAYOUTS.hero,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
    overlap: true,
    mediaTreatment: HERO_MEDIA_TREATMENT,
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
    layout: LAYOUTS.banner,
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
    display: true,
    separator: true,
  },
  // CUST-HV V8a (V0 §3.4) — twin of PHP: no `text` (colours are per slide, over each picture)
  // and no `layout` yet (`split` puts the copy on the section surface — its own proof, later).
  slider: {
    background: BACKGROUND_KINDS,
    width: true,
    spacing: true,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
    mediaTreatment: ["height"],
  },
  // CUST-HV V8d (V0 §3.4) — twin of PHP: no `text` (the caption sits on the section surface in the proven automatic colour)
  // and no `mediaTreatment` (the aspect is `content.options.aspect`); the layout is `grid` (absence) or `carousel`.
  gallery: {
    background: BACKGROUND_KINDS,
    width: true,
    spacing: true,
    layout: LAYOUTS.gallery,
    border: true,
    radius: true,
    shadow: true,
    separator: true,
  },
  newArrivals: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    layout: LAYOUTS.shelf,
    columns: SHELF_COLUMNS,
    cards: true,
    separator: true,
  },
  featured: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    layout: LAYOUTS.shelf,
    columns: SHELF_COLUMNS,
    cards: true,
    separator: true,
  },
  offers: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    columns: SHELF_COLUMNS,
    cards: true,
    separator: true,
  },
  productShelf: {
    background: BACKGROUND_KINDS,
    text: ["heading"],
    typography: ["headingStyle"],
    width: true,
    spacing: true,
    layout: LAYOUTS.shelf,
    columns: SHELF_COLUMNS,
    cards: true,
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
    layout: LAYOUTS.benefits,
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
export function normalizeBackgroundRef(raw: unknown): MediaRef | undefined {
  const ref = normalizeMediaRef(raw);
  if (!ref) return undefined;
  const { fit: _fit, alt: _alt, ...rest } = ref;
  return { ...rest, decorative: true };
}

export function normalizeMediaOverlay(raw: unknown): MediaOverlay | undefined {
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

/** An integral JSON number is clamped into [min, max]; anything else (fraction, string, boolean…) is `undefined`. */
function clampInt(
  value: unknown,
  [min, max]: readonly [number, number],
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return Math.max(min, Math.min(max, value));
}

function normalizePerDevice(
  raw: unknown,
  rangeOf: (device: DisplayDevice) => readonly [number, number],
): PerDevice | undefined {
  if (!isRecord(raw)) return undefined;
  const out: PerDevice = {};
  for (const device of DISPLAY_DEVICES) {
    const value = clampInt(raw[device], rangeOf(device));
    if (value !== undefined) out[device] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeDisplayCard(raw: unknown): DisplayCard | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DisplayCard = {};
  const style = pick(raw.style, DISPLAY_CARD_STYLES);
  if (style) out.style = style;
  const background = pick(raw.background, DISPLAY_CARD_BACKGROUNDS);
  if (background) out.background = background;
  const borderColor = pick(raw.borderColor, DISPLAY_CARD_BORDER_COLORS);
  if (borderColor) out.borderColor = borderColor;
  const borderWidth = clampInt(
    raw.borderWidth,
    DISPLAY_CARD_BORDER_WIDTH_RANGE,
  );
  if (borderWidth !== undefined) out.borderWidth = borderWidth;
  const radius = clampInt(raw.radius, DISPLAY_CARD_RADIUS_RANGE);
  if (radius !== undefined) out.radius = radius;
  const padding = clampInt(raw.padding, DISPLAY_CARD_PADDING_RANGE);
  if (padding !== undefined) out.padding = padding;
  const hover = pick(raw.hover, DISPLAY_CARD_HOVERS);
  if (hover) out.hover = hover;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeDisplayImage(raw: unknown): DisplayImage | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DisplayImage = {};
  if (raw.show === false) out.show = false;
  const shape = pick(raw.shape, DISPLAY_IMAGE_SHAPES);
  if (shape) out.shape = shape;
  const aspect = pick(raw.aspect, DISPLAY_IMAGE_ASPECTS);
  if (aspect) out.aspect = aspect;
  const fit = pick(raw.fit, DISPLAY_IMAGE_FITS);
  if (fit) out.fit = fit;
  const position = pick(raw.position, DISPLAY_IMAGE_POSITIONS);
  if (position) out.position = position;
  const height = normalizePerDevice(
    raw.height,
    () => DISPLAY_IMAGE_HEIGHT_RANGE,
  );
  if (height) out.height = height;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeDisplayName(raw: unknown): DisplayName | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DisplayName = {};
  if (raw.show === false) out.show = false;
  const placement = pick(raw.placement, DISPLAY_NAME_PLACEMENTS);
  if (placement) out.placement = placement;
  const align = pick(raw.align, ALIGNS);
  if (align) out.align = align;
  const size = clampInt(raw.size, DISPLAY_NAME_SIZE_RANGE);
  if (size !== undefined) out.size = size;
  const weight = pick(raw.weight, DISPLAY_NAME_WEIGHTS);
  if (weight) out.weight = weight;
  const color = pick(raw.color, DISPLAY_NAME_COLORS);
  if (color) out.color = color;
  const lines = pick(raw.lines, DISPLAY_NAME_LINES);
  if (lines !== undefined) out.lines = lines;
  const background = pick(raw.background, DISPLAY_NAME_BACKGROUNDS);
  if (background) out.background = background;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `design.display` of a `categories` section. `layout` gates the group: without a valid one nothing survives
 * (the classic tile). Canonical key order: layout, columns, gap, itemWidth, card, image, name.
 */
export function normalizeDisplay(raw: unknown): CategoryDisplay | undefined {
  if (!isRecord(raw)) return undefined;
  const layout = pick(raw.layout, DISPLAY_LAYOUTS);
  if (!layout) return undefined;
  const out: CategoryDisplay = { layout };
  const columns = normalizePerDevice(
    raw.columns,
    (d) => DISPLAY_COLUMN_RANGES[d],
  );
  if (columns) out.columns = columns;
  const gap = normalizePerDevice(raw.gap, () => DISPLAY_GAP_RANGE);
  if (gap) out.gap = gap;
  const itemWidth = normalizePerDevice(
    raw.itemWidth,
    () => DISPLAY_ITEM_WIDTH_RANGE,
  );
  if (itemWidth) out.itemWidth = itemWidth;
  const card = normalizeDisplayCard(raw.card);
  if (card) out.card = card;
  const image = normalizeDisplayImage(raw.image);
  if (image) out.image = image;
  const name = normalizeDisplayName(raw.name);
  if (name) out.name = name;
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
  if (Array.isArray(capability.layout)) {
    const layout = pick(raw.layout, capability.layout as readonly string[]);
    if (layout)
      out.layout = layout as
        | HeroLayout
        | BannerLayout
        | GalleryLayout
        | BenefitsLayout
        | ShelfLayout;
  }
  if (Array.isArray(capability.columns)) {
    const columns = pick(raw.columns, capability.columns as readonly number[]);
    if (columns) out.columns = columns as ShelfColumns;
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
  if (capability.cards) {
    const cards = normalizeGlobalCards(raw.cards);
    if (cards) out.cards = cards;
  }
  if (capability.display) {
    const display = normalizeDisplay(raw.display);
    if (display) out.display = display;
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
  if (capability.mediaTreatment && isRecord(raw.mediaTreatment)) {
    const treatment: SectionMediaTreatment = {};
    if (allowsField(capability.mediaTreatment, "height")) {
      const height = pick(raw.mediaTreatment.height, HEIGHT_PRESETS);
      if (height) treatment.height = height;
    }
    if (allowsField(capability.mediaTreatment, "mobileHeight")) {
      const mobileHeight = pick(
        raw.mediaTreatment.mobileHeight,
        HEIGHT_PRESETS,
      );
      if (mobileHeight) treatment.mobileHeight = mobileHeight;
    }
    if (allowsField(capability.mediaTreatment, "ratio")) {
      const ratio = pick(raw.mediaTreatment.ratio, MEDIA_RATIOS);
      if (ratio) treatment.ratio = ratio;
    }
    // Stored only as `true` (absent = contained): any other value drops the key.
    if (
      allowsField(capability.mediaTreatment, "bleed") &&
      raw.mediaTreatment.bleed === true
    ) {
      treatment.bleed = true;
    }
    if (Object.keys(treatment).length > 0) out.mediaTreatment = treatment;
  }
  if (capability.motion && isRecord(raw.motion)) {
    const reveal = pick(raw.motion.reveal, REVEALS);
    if (reveal) out.motion = { reveal };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
