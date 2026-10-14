/**
 * AWJ-VD-H1 / VD-1a — the visual identity of a commerce facet (dimension) and of its values
 * (contract: docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md §3.3–§3.6, D-01/D-08/D-09).
 *
 * Twin of PHP `CommerceFacetVisualNormalizer` + `CommerceFacetVisualResolver` and of
 * `web/.../presentation/facet-visual.ts` (byte-identical, test-enforced). The same fixtures drive all three:
 * `tests/Fixtures/presentation/facet-visual.json` and `facet-visual-inheritance.json`.
 *
 * - Normalising is lenient and deterministic: an invalid field is dropped on its own, and an **absent key means
 *   "inherit"**. Output key order is fixed and a normalised document is a fixed point.
 * - The image is a subset of `MediaRef` (`mediaId · fit · focal · zoom · alt · decorative`). Crop and rotate never
 *   survive: the shape is a render-time mask over the library's base thumbnails, not baked pixels. `fit` is kept
 *   explicitly (even `cover`), because its absence means "inherit from the facet defaults".
 * - Resolving: **every property resolves on its own chain** — customising the image never cancels inheritance of
 *   the shape, size, label or fallback icon. Then a render-time fallback (image → icon → none) that keeps the
 *   resolved shape, size and label.
 *
 * Data only (no React). Shape geometry is not here: documents carry the shape **key** only.
 */

import { ICON_KEYS, type IconKey } from "./icon-registry";
import { type LocalizedAlt, normalizeMediaRef } from "./media-ref";

export const FACET_VISUAL_CONTENTS = ["image", "icon", "none"] as const;
export type FacetVisualContent = (typeof FACET_VISUAL_CONTENTS)[number];

/** Media frame shapes (not the card shape). Append-only. */
export const FACET_VISUAL_SHAPES = [
  "circle",
  "square",
  "rounded",
  "landscape",
  "portrait",
  "oval",
  "star",
  "heart",
  "diamond",
  "hexagon",
  "vase",
  "arch",
] as const;
export type FacetVisualShape = (typeof FACET_VISUAL_SHAPES)[number];

export const FACET_VISUAL_SHAPE_LABELS: Readonly<
  Record<FacetVisualShape, { ar: string; en: string }>
> = {
  circle: { ar: "دائري", en: "Circle" },
  square: { ar: "مربع", en: "Square" },
  rounded: { ar: "مربع بزوايا دائرية", en: "Rounded square" },
  landscape: { ar: "مستطيل أفقي", en: "Landscape" },
  portrait: { ar: "مستطيل رأسي", en: "Portrait" },
  oval: { ar: "بيضاوي", en: "Oval" },
  star: { ar: "نجمة", en: "Star" },
  heart: { ar: "قلب", en: "Heart" },
  diamond: { ar: "معيّن", en: "Diamond" },
  hexagon: { ar: "سداسي", en: "Hexagon" },
  vase: { ar: "مزهرية", en: "Vase" },
  arch: { ar: "قوس إسلامي", en: "Islamic arch" },
};

export const FACET_VISUAL_SIZES = ["sm", "md", "lg"] as const;
export type FacetVisualSize = (typeof FACET_VISUAL_SIZES)[number];

export const FACET_VISUAL_FITS = ["cover", "contain"] as const;
export type FacetVisualFit = (typeof FACET_VISUAL_FITS)[number];

export const FACET_VISUAL_ZOOM_MIN = 1;
export const FACET_VISUAL_ZOOM_MAX = 3;

export const FACET_VISUAL_DEFAULTS = {
  content: "none",
  shape: "circle",
  size: "md",
  fit: "cover",
  showLabel: true,
} as const;

export interface FacetVisualImage {
  mediaId: string;
  fit?: FacetVisualFit;
  focal?: { x: number; y: number };
  zoom?: number;
  alt?: LocalizedAlt;
  decorative?: true;
}

/** A value's visual, and also a facet's own `self` appearance. Every key optional: absent = inherit. */
export interface FacetValueVisual {
  content?: FacetVisualContent;
  image?: FacetVisualImage;
  icon?: IconKey;
  iconColor?: string;
  background?: string;
  shape?: FacetVisualShape;
  size?: FacetVisualSize;
  showLabel?: boolean;
}

/** What a facet's values inherit. No image: images are never inherited. */
export interface FacetVisualDefaults {
  content?: FacetVisualContent;
  icon?: IconKey;
  iconColor?: string;
  background?: string;
  shape?: FacetVisualShape;
  size?: FacetVisualSize;
  fit?: FacetVisualFit;
  showLabel?: boolean;
}

export interface FacetVisual {
  self?: FacetValueVisual;
  defaults?: FacetVisualDefaults;
}

const VALUE_KEYS = [
  "content",
  "image",
  "icon",
  "iconColor",
  "background",
  "shape",
  "size",
  "showLabel",
] as const;
const DEFAULTS_KEYS = [
  "content",
  "icon",
  "iconColor",
  "background",
  "shape",
  "size",
  "fit",
  "showLabel",
] as const;
const LAYOUT_KEYS = ["shape", "size", "showLabel"] as const;
const HEX = /^#[0-9a-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inList<T extends string>(
  value: unknown,
  list: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** PHP `round($x, $dp)` — half away from zero on the decimal representation (same as `media-ref.ts`). */
function roundHalfAway(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(
    Number((Math.abs(value) * factor).toPrecision(15)),
  );
  return (Math.sign(value) * rounded) / factor;
}

function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  return HEX.test(lower) ? lower : undefined;
}

/** Clamped to [1, 3] and rounded to 2 dp; 1 is the default and is not stored. */
function normalizeZoom(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const zoom = roundHalfAway(
    Math.min(FACET_VISUAL_ZOOM_MAX, Math.max(FACET_VISUAL_ZOOM_MIN, value)),
    2,
  );
  return zoom === FACET_VISUAL_ZOOM_MIN ? undefined : zoom;
}

function normalizeImage(raw: unknown): FacetVisualImage | undefined {
  if (!isRecord(raw)) return undefined;
  // Id, focal, alt and decorative go through the existing MediaRef rules; crop and rotate are never passed in.
  const ref = normalizeMediaRef({
    mediaId: raw.mediaId,
    focal: raw.focal,
    alt: raw.alt,
    decorative: raw.decorative,
  });
  if (!ref) return undefined;

  const image: FacetVisualImage = { mediaId: ref.mediaId };
  const fit = inList(raw.fit, FACET_VISUAL_FITS);
  if (fit) image.fit = fit;
  if (ref.focal) image.focal = ref.focal;
  const zoom = normalizeZoom(raw.zoom);
  if (zoom !== undefined) image.zoom = zoom;
  if (ref.alt) image.alt = ref.alt;
  if (ref.decorative) image.decorative = true;
  return image;
}

function normalizeField(key: string, value: unknown): unknown {
  switch (key) {
    case "content":
      return inList(value, FACET_VISUAL_CONTENTS);
    case "image":
      return normalizeImage(value);
    case "icon":
      return inList(value, ICON_KEYS);
    case "iconColor":
    case "background":
      return normalizeHex(value);
    case "shape":
      return inList(value, FACET_VISUAL_SHAPES);
    case "size":
      return inList(value, FACET_VISUAL_SIZES);
    case "fit":
      return inList(value, FACET_VISUAL_FITS);
    case "showLabel":
      return typeof value === "boolean" ? value : undefined;
    default:
      return undefined;
  }
}

function normalizeAppearance(
  raw: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = normalizeField(key, raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A normalised value visual; `{}` = nothing customised (inherit everything). */
export function normalizeFacetValueVisual(raw: unknown): FacetValueVisual {
  return isRecord(raw)
    ? (normalizeAppearance(raw, VALUE_KEYS) as FacetValueVisual)
    : {};
}

/** A normalised facet visual `{self?, defaults?}`; `{}` = nothing customised. */
export function normalizeFacetVisual(raw: unknown): FacetVisual {
  if (!isRecord(raw)) return {};
  const out: FacetVisual = {};
  const self = isRecord(raw.self)
    ? normalizeAppearance(raw.self, VALUE_KEYS)
    : {};
  if (Object.keys(self).length > 0) out.self = self as FacetValueVisual;
  const defaults = isRecord(raw.defaults)
    ? normalizeAppearance(raw.defaults, DEFAULTS_KEYS)
    : {};
  if (Object.keys(defaults).length > 0)
    out.defaults = defaults as FacetVisualDefaults;
  return out;
}

// ───────────────────────────── resolution ─────────────────────────────

export type FacetVisualLayout = Pick<
  FacetValueVisual,
  "shape" | "size" | "showLabel"
>;

export interface FacetVisualContext {
  /** Explicit section overrides (L3). Only shape/size/showLabel count. */
  section?: unknown;
  /** The section template's fallback appearance (L3). Only shape/size/showLabel count. */
  template?: unknown;
  /** Ids of media known to be ready and tenant-owned; `null`/absent = assume usable (preview). */
  usableMediaIds?: readonly string[] | null;
}

export interface ResolvedFacetVisual {
  content: FacetVisualContent;
  image?: FacetVisualImage & { fit: FacetVisualFit };
  icon?: IconKey;
  iconColor?: string;
  background?: string;
  shape: FacetVisualShape;
  size: FacetVisualSize;
  showLabel: boolean;
}

export type FacetVisualSource =
  | "section"
  | "value"
  | "implicit"
  | "facet"
  | "template"
  | "system";

export interface FacetVisualSources {
  content: FacetVisualSource;
  icon: FacetVisualSource | null;
  iconColor: FacetVisualSource | null;
  background: FacetVisualSource | null;
  /** The requested content when a fallback replaced it, else `null`. */
  fallback: FacetVisualContent | null;
  fit: FacetVisualSource | null;
  shape: FacetVisualSource;
  size: FacetVisualSource;
  showLabel: FacetVisualSource;
}

export interface FacetVisualResolution {
  visual: ResolvedFacetVisual;
  sources: FacetVisualSources;
}

function layout(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const picked: Record<string, unknown> = {};
  for (const key of LAYOUT_KEYS) if (key in raw) picked[key] = raw[key];
  return normalizeAppearance(picked, LAYOUT_KEYS);
}

function pick(
  key: string,
  own: Record<string, unknown>,
  inherited: Record<string, unknown>,
): [unknown, FacetVisualSource | null] {
  if (key in own) return [own[key], "value"];
  if (key in inherited) return [inherited[key], "facet"];
  return [undefined, null];
}

function resolve(
  own: Record<string, unknown>,
  inherited: Record<string, unknown>,
  section: Record<string, unknown>,
  template: Record<string, unknown>,
  usable: readonly string[] | null | undefined,
): FacetVisualResolution {
  let requested: FacetVisualContent;
  let contentSource: FacetVisualSource;
  if ("content" in own)
    [requested, contentSource] = [own.content as FacetVisualContent, "value"];
  else if ("image" in own) [requested, contentSource] = ["image", "implicit"];
  else if ("icon" in own) [requested, contentSource] = ["icon", "implicit"];
  else if ("content" in inherited)
    [requested, contentSource] = [
      inherited.content as FacetVisualContent,
      "facet",
    ];
  else [requested, contentSource] = [FACET_VISUAL_DEFAULTS.content, "system"];

  const [icon, iconSource] = pick("icon", own, inherited);
  const [iconColor, iconColorSource] = pick("iconColor", own, inherited);
  const [background, backgroundSource] = pick("background", own, inherited);

  const image = own.image as FacetVisualImage | undefined;
  // Stored ids are lowercase; the incoming list is normalised the same way so case never drops a valid image.
  const imageUsable =
    image !== undefined &&
    (usable == null ||
      usable.some(
        (id) =>
          typeof id === "string" && id.trim().toLowerCase() === image.mediaId,
      ));
  let content: FacetVisualContent = requested;
  if (content === "image" && !imageUsable) content = "icon";
  if (content === "icon" && icon === undefined) content = "none";

  const visual = { content } as ResolvedFacetVisual;
  let fitSource: FacetVisualSource | null = null;
  if (content === "image" && image) {
    const fit = (image.fit ??
      inherited.fit ??
      FACET_VISUAL_DEFAULTS.fit) as FacetVisualFit;
    fitSource = image.fit ? "value" : "fit" in inherited ? "facet" : "system";
    const resolvedImage = {
      mediaId: image.mediaId,
      fit,
    } as FacetVisualImage & { fit: FacetVisualFit };
    if (image.focal) resolvedImage.focal = image.focal;
    if (image.zoom !== undefined) resolvedImage.zoom = image.zoom;
    if (image.alt) resolvedImage.alt = image.alt;
    if (image.decorative) resolvedImage.decorative = true;
    visual.image = resolvedImage;
  }
  if (content === "icon") {
    visual.icon = icon as IconKey;
    if (iconColor !== undefined) visual.iconColor = iconColor as string;
  }
  // The background shows behind icons, text and a `contain` image, and is the placeholder behind any image until it
  // loads — so it is emitted whenever set and the renderer decides what shows. Absent = theme tokens.
  if (background !== undefined) visual.background = background as string;

  const layoutSources = {} as Record<
    (typeof LAYOUT_KEYS)[number],
    FacetVisualSource
  >;
  const systemDefaults = {
    shape: FACET_VISUAL_DEFAULTS.shape,
    size: FACET_VISUAL_DEFAULTS.size,
    showLabel: FACET_VISUAL_DEFAULTS.showLabel,
  };
  const target = visual as unknown as Record<string, unknown>;
  for (const key of LAYOUT_KEYS) {
    if (key in section)
      [target[key], layoutSources[key]] = [section[key], "section"];
    else if (key in own)
      [target[key], layoutSources[key]] = [own[key], "value"];
    else if (key in inherited)
      [target[key], layoutSources[key]] = [inherited[key], "facet"];
    else if (key in template)
      [target[key], layoutSources[key]] = [template[key], "template"];
    else [target[key], layoutSources[key]] = [systemDefaults[key], "system"];
  }

  return {
    visual,
    sources: {
      content: contentSource,
      icon: iconSource,
      iconColor: iconColorSource,
      background: backgroundSource,
      fallback: content === requested ? null : requested,
      fit: fitSource,
      ...layoutSources,
    },
  };
}

/** The effective visual of one value: per-property inheritance, then the render-time fallback. */
export function resolveFacetValueVisual(
  facetVisual: unknown,
  valueVisual: unknown,
  context: FacetVisualContext = {},
): FacetVisualResolution {
  const facet = normalizeFacetVisual(facetVisual);
  return resolve(
    normalizeFacetValueVisual(valueVisual) as Record<string, unknown>,
    (facet.defaults ?? {}) as Record<string, unknown>,
    layout(context.section),
    layout(context.template),
    context.usableMediaIds,
  );
}

/** The facet's own appearance (its card/cover): `self` → template → system. Independent of `defaults`. */
export function resolveFacetSelfVisual(
  facetVisual: unknown,
  context: Pick<FacetVisualContext, "template" | "usableMediaIds"> = {},
): FacetVisualResolution {
  const facet = normalizeFacetVisual(facetVisual);
  return resolve(
    (facet.self ?? {}) as Record<string, unknown>,
    {},
    {},
    layout(context.template),
    context.usableMediaIds,
  );
}
