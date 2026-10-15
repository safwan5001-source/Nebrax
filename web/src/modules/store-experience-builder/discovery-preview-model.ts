/**
 * AWJ-VD-H1 / VD-4c (+ VD-5 owner fix) — the data behind the discovery panel preview, and the pure choice of which
 * values to show.
 *
 * Preview only: nothing here is stored. Two sources:
 *  - **real** — the merchant's own dimension, as the builder already loads it (`GET /commerce/workspace/facets`):
 *    names, counts **and the stored look of every value** (`visual`, the dimension's `defaults`, and the short-lived
 *    signed thumbnail `visualPreview` of a stored image). Each tile is resolved through the same shared chain the
 *    storefront uses (`resolveFacetValueVisual`), so a heart-shaped picture is a heart-shaped picture here too. A value
 *    whose picture cannot be previewed is drawn with the same fallback the store would use (icon, then initial) and the
 *    panel says WHY (`previewNotes`), never pretending the picture loaded.
 *  - **sample** — built-in names and placeholder pictures, only when no usable dimension is chosen or loaded. It is
 *    always labelled as a sample (`SampleReason`): the three kinds of sample look (picture, broken picture, name only)
 *    illustrate the happy path and the fallbacks, but are never the merchant's data.
 */

import type { Facet } from "@/modules/commerce-workspace/merchandising/client";
import { previewImage } from "@/modules/commerce-workspace/merchandising/visual-editor/use-image-source";
import type { FacetVisualTileImage } from "./FacetVisualTile";
import type { CustomizerLocale } from "./messages";
import {
  type FacetValueVisual,
  type FacetVisual,
  type FacetVisualContext,
  type FacetVisualResolution,
  type ResolvedFacetVisual,
  resolveFacetValueVisual,
} from "./presentation/facet-visual";
import { normalizeIconKey } from "./presentation/icon-registry";
import type { IconKey } from "./presentation/icon-registry";
import type { DiscoveryValueSort } from "./presentation/section-content";

/** The preview is compact: it never draws more than this many values, whatever `maxItems` says. */
export const DISCOVERY_PREVIEW_CAP = 12;

/** How a sample value's media is drawn. */
export type PreviewMedia = "picture" | "broken" | "initial" | "icon";

/** What a real value brings with it: its stored look and the signed thumbnail of its stored image (if any). */
export interface StoredLook {
  /** The value's own identity document (`null` = none stored). */
  visual: FacetValueVisual | null;
  /** The dimension's `{self?, defaults?}`: what a value without a look of its own inherits. */
  facetVisual: FacetVisual | null;
  /** Renderable signed thumbnail of the stored image; `null` = no image, or no preview available for it. */
  image: FacetVisualTileImage | null;
}

export interface PreviewValue {
  id: string;
  label: string;
  count: number;
  media: PreviewMedia;
  /** Sample picture index (selects one of the placeholder pictures); only for `picture`. */
  picture: number;
  icon: IconKey;
  /** Present for values of a real dimension. Sample values carry none, and draw their placeholder looks. */
  stored?: StoredLook;
}

interface SampleSeed {
  ar: string;
  en: string;
  count: number;
  media: PreviewMedia;
  icon: IconKey;
}

/** 12 gift-shop occasions. #11 is deliberately long to expose clipping/overflow in tight columns. */
const SAMPLE_SEEDS: readonly SampleSeed[] = [
  { ar: "عيد ميلاد", en: "Birthday", count: 24, media: "picture", icon: "cake" },
  { ar: "زفاف", en: "Wedding", count: 18, media: "picture", icon: "heart" },
  { ar: "تخرّج", en: "Graduation", count: 15, media: "broken", icon: "graduation-cap" },
  { ar: "مولود جديد", en: "New baby", count: 12, media: "picture", icon: "baby" },
  { ar: "شكر وتقدير", en: "Thank you", count: 9, media: "icon", icon: "hand-heart" },
  { ar: "تهنئة", en: "Congratulations", count: 21, media: "picture", icon: "party-popper" },
  { ar: "عيد الأم", en: "Mother's Day", count: 7, media: "initial", icon: "flower" },
  { ar: "خطوبة", en: "Engagement", count: 5, media: "picture", icon: "gem" },
  { ar: "ذكرى سنوية", en: "Anniversary", count: 14, media: "picture", icon: "heart" },
  { ar: "تعافٍ عاجل", en: "Get well soon", count: 3, media: "broken", icon: "smile" },
  {
    ar: "باقات الورد البلدي المميّزة لمناسبات الأعياد الكبرى",
    en: "Signature local rose bouquets for the big holiday occasions",
    count: 11,
    media: "picture",
    icon: "flower",
  },
  { ar: "اعتذار", en: "Apology", count: 2, media: "picture", icon: "sparkles" },
];

/**
 * Why the preview shows samples instead of the merchant's dimension — always said to the merchant, so a placeholder
 * picture can never be mistaken for one of their images.
 *  - `no_dimension`: the section has no dimension chosen yet.
 *  - `brand`: the brand axis; brand logos are not previewed.
 *  - `loading`: the dimension list has not loaded (or could not be loaded).
 *  - `empty`: the chosen dimension is gone, or has no active values.
 */
export type SampleReason = "no_dimension" | "brand" | "loading" | "empty";

export interface PreviewSource {
  /** `real`: the loaded dimension's values and looks; `sample`: the built-in samples. */
  kind: "real" | "sample";
  /** Only for `sample`. */
  reason?: SampleReason;
  values: PreviewValue[];
  /** Real source only: values of the dimension that are switched off. The store never shows them, so neither do we. */
  inactiveHidden: number;
}

/** All values of the chosen dimension in merchant order (active only), or the reason none can be used. */
function realValues(
  facets: readonly Facet[] | null,
  axis: "facet" | "brand",
  dimension: string,
  locale: CustomizerLocale,
): { values: PreviewValue[]; inactiveHidden: number } | SampleReason {
  if (axis !== "facet") return "brand";
  if (dimension === "") return "no_dimension";
  if (!facets) return "loading";
  const facet = facets.find((candidate) => candidate.key === dimension);
  if (!facet) return "empty";
  const active = facet.values.filter((value) => value.isActive);
  if (active.length === 0) return "empty";
  const values = [...active]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((value, index): PreviewValue => ({
      id: value.id,
      label: locale === "en" && value.nameEn ? value.nameEn : value.name,
      count: value.productCount,
      media: "initial",
      picture: index,
      icon: "gift",
      stored: {
        visual: value.visual,
        facetVisual: facet.visual,
        image: previewImage(value.visualPreview),
      },
    }));
  return { values, inactiveHidden: facet.values.length - active.length };
}

function sampleValues(locale: CustomizerLocale): PreviewValue[] {
  return SAMPLE_SEEDS.map((seed, index) => ({
    id: `sample-${index}`,
    label: seed[locale],
    count: seed.count,
    media: seed.media,
    picture: index,
    icon: seed.icon,
  }));
}

export function previewSource(input: {
  facets: readonly Facet[] | null;
  axis: "facet" | "brand";
  dimension: string;
  locale: CustomizerLocale;
}): PreviewSource {
  const real = realValues(input.facets, input.axis, input.dimension, input.locale);
  return typeof real === "string"
    ? { kind: "sample", reason: real, values: sampleValues(input.locale), inactiveHidden: 0 }
    : { kind: "real", values: real.values, inactiveHidden: real.inactiveHidden };
}

/**
 * Which values the preview draws, in order: `valueSort` (merchant order, or most products first — stable), then
 * `maxItems`, then the preview cap. Returns also how many were left out so the preview can say so.
 */
export function previewSelection(
  values: readonly PreviewValue[],
  valueSort: DiscoveryValueSort,
  maxItems: number,
): { shown: PreviewValue[]; hidden: number } {
  const ordered =
    valueSort === "count"
      ? values.map((value, index) => ({ value, index })).sort((a, b) => b.value.count - a.value.count || a.index - b.index).map((entry) => entry.value)
      : [...values];
  const limit = Math.min(maxItems, DISCOVERY_PREVIEW_CAP);
  const shown = ordered.slice(0, limit);
  return { shown, hidden: Math.max(0, Math.min(ordered.length, maxItems) - shown.length) };
}

/**
 * The value visual (VD-1a shape) a preview value is drawn from. The image id is a placeholder UUID — the tile gets a
 * sample picture (or none, to show the fallback) separately and nothing is requested from the media library.
 */
export function previewValueVisual(value: PreviewValue, iconFirst: boolean): FacetValueVisual {
  // `icon-grid` (VD-4b, §3.6 rule 3): the resolved icon first, then the image, then the text. A value with no icon of
  // its own to show keeps its image / initial.
  if (iconFirst && value.media !== "initial") return { content: "icon", icon: value.icon };
  switch (value.media) {
    case "picture":
      return {
        content: "image",
        image: { mediaId: "00000000-0000-4000-8000-000000000001" },
        icon: value.icon,
      };
    case "broken":
      // A picture that cannot be shown: the tile falls back to the value's icon.
      return {
        content: "image",
        image: { mediaId: "00000000-0000-4000-8000-000000000002" },
        icon: value.icon,
      };
    case "icon":
      return { content: "icon", icon: value.icon };
    default:
      // A picture with no icon and nothing to draw: the tile falls back to the name's initial.
      return { content: "image", image: { mediaId: "00000000-0000-4000-8000-000000000003" } };
  }
}

/** Width of a frame per size step, in px (the tile's own table, mirrored here without importing React). */
const CAROUSEL_ITEM_PADDING_PX = 24;
const CAROUSEL_ITEM_MIN_PX = 88;

/**
 * VD-4b: a carousel column is as wide as the widest frame plus padding (never narrower than 88 px). The carousel does
 * **not** use `columns`; those drive the grid layouts only.
 */
export function previewCarouselItemWidth(framePx: readonly number[]): number {
  return Math.max(CAROUSEL_ITEM_MIN_PX, Math.max(0, ...framePx) + CAROUSEL_ITEM_PADDING_PX);
}

/** VD-4b: a second carousel row exists only on mobile (below `md`); from tablet up it is one row. */
export function previewCarouselRows(rows: number, device: "mobile" | "tablet" | "desktop"): number {
  return device === "mobile" ? rows : 1;
}

// ───────────────────────────── real values: the same chain the storefront draws ─────────────────────────────

/** A resolved tile of a real value: the visual to draw and the image it can actually draw (`null` = fall back). */
export interface StoredTile {
  visual: ResolvedFacetVisual;
  image: FacetVisualTileImage | null;
  resolution: FacetVisualResolution;
}

/**
 * Storefront `keepsFrame` rule (`discovery-items.ts`): `content: "none"` is a choice (text only, frameless) only when
 * the merchant set it; "nothing set anywhere" or "an image/icon that is not available" is a fallback and keeps the
 * shaped frame with the name's initial.
 */
function keepsFrame(resolution: FacetVisualResolution): ResolvedFacetVisual {
  const { visual, sources } = resolution;
  const textByChoice = visual.content === "none" && sources.content !== "system" && sources.fallback === null;
  return visual.content === "none" && !textByChoice ? { ...visual, content: "icon" } : visual;
}

/** `icon-grid` (VD-4b §3.6 rule 3): the resolved icon first, then the image, then the text. */
function iconFirst(visual: ResolvedFacetVisual): ResolvedFacetVisual {
  const icon = visual.content === "icon" ? visual.icon : visual.content === "image" ? visual.fallbackIcon : undefined;
  if (icon === undefined) return visual;
  const { image: _image, fallbackIcon: _fallback, ...rest } = visual;
  return { ...rest, content: "icon", icon };
}

/**
 * The image a real value can really show: its stored image **and** a signed thumbnail for it **and** no load failure
 * reported since that link was issued. Anything else resolves to `[]`, so the shared resolver falls back (icon → text).
 */
function usableMedia(stored: StoredLook, failed: boolean): readonly string[] {
  return stored.visual?.image && stored.image && !failed ? [stored.visual.image.mediaId] : [];
}

export function resolveStoredTile(
  value: PreviewValue,
  options: {
    layout: "image-grid" | "image-cards" | "carousel" | "icon-grid";
    section: FacetVisualContext["section"];
    template: FacetVisualContext["template"];
    /** The signed thumbnail of this value failed to load in the browser. */
    failed?: boolean;
  },
): StoredTile {
  const stored = value.stored ?? { visual: null, facetVisual: null, image: null };
  const resolution = resolveFacetValueVisual(stored.facetVisual ?? {}, stored.visual ?? {}, {
    section: options.section,
    template: options.template,
    usableMediaIds: usableMedia(stored, options.failed === true),
  });
  const framed = keepsFrame(resolution);
  const visual = options.layout === "icon-grid" ? iconFirst(framed) : framed;
  return {
    visual,
    image: visual.content === "image" && visual.image ? stored.image : null,
    resolution,
  };
}

// ───────────────────────────── why a tile does not look as the merchant expects ─────────────────────────────

/**
 * Reasons a real value is not drawn as its picture, or will not appear in the store — each one is said in words.
 *  - `image_unavailable`: the value has a stored image but the list returned no preview link for it (still processing,
 *    deleted, or not previewable). The store may still have it; the builder cannot show it.
 *  - `image_failed`: a preview link was given but the browser could not load it (signed links expire after ~20 min).
 *  - `no_look`: no picture and no icon, here or inherited from the dimension: drawn as the name's initial.
 *  - `no_products`: no product carries the value, so the published store does not list it.
 */
export type PreviewNote = "image_unavailable" | "image_failed" | "no_look" | "no_products";

export const PREVIEW_NOTE_ORDER: readonly PreviewNote[] = ["image_failed", "image_unavailable", "no_look", "no_products"];

/** Notes of one real value. `media` = the layout draws pictures/icons (false for `text-list` and the legacy look). */
export function previewNotes(value: PreviewValue, options: { media: boolean; failed?: boolean }): PreviewNote[] {
  if (!value.stored) return [];
  const notes: PreviewNote[] = [];
  if (options.media) {
    const { visual, facetVisual, image } = value.stored;
    const resolution = resolveFacetValueVisual(facetVisual ?? {}, visual ?? {}, {
      usableMediaIds: usableMedia(value.stored, options.failed === true),
    });
    if (options.failed && image) notes.push("image_failed");
    else if (resolution.sources.fallback === "image") notes.push("image_unavailable");
    else if (resolution.visual.content === "none" && resolution.sources.content === "system") notes.push("no_look");
    else if (resolution.visual.content === "icon" && normalizeIconKey(resolution.visual.icon) === undefined) notes.push("no_look");
  }
  if (value.count === 0) notes.push("no_products");
  return notes;
}

export interface PreviewNoteGroup {
  note: PreviewNote;
  /** Labels of the values it applies to, in preview order. */
  labels: string[];
}

/** Notes of every drawn value, grouped by reason (fixed order), so the panel says each thing once. */
export function previewNoteGroups(
  values: readonly PreviewValue[],
  options: { media: boolean; failed?: ReadonlySet<string> },
): PreviewNoteGroup[] {
  const by = new Map<PreviewNote, string[]>();
  for (const value of values) {
    for (const note of previewNotes(value, { media: options.media, failed: options.failed?.has(failureKey(value)) })) {
      by.set(note, [...(by.get(note) ?? []), value.label]);
    }
  }
  return PREVIEW_NOTE_ORDER.filter((note) => by.has(note)).map((note) => ({ note, labels: by.get(note) ?? [] }));
}

/**
 * A load failure is remembered per value **and per link**: a reload brings a fresh signed link, a new key, so the
 * failure state clears by itself and the picture is tried again.
 */
export function failureKey(value: PreviewValue): string {
  return `${value.id}|${value.stored?.image?.src ?? ""}`;
}
