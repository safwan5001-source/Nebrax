/**
 * AWJ-VD-H1 / VD-4c — the sample data behind the discovery panel preview, and the pure choice of which values to show.
 *
 * Preview only: nothing here is stored. Value *names* and counts come from the merchant's real facet when the panel has
 * loaded it; looks (image, icon, fallback) are always samples, because the builder does not read value visuals. The
 * three kinds of sample look cover what a shopper can meet: a value with a picture, a value whose picture cannot be
 * shown (icon fallback) and a value with nothing but a name (initial fallback) — so the merchant sees the fallback
 * look, not only the happy path.
 */

import type { Facet } from "@/modules/commerce-workspace/merchandising/client";
import type { CustomizerLocale } from "./messages";
import type { FacetValueVisual } from "./presentation/facet-visual";
import type { IconKey } from "./presentation/icon-registry";
import type { DiscoveryValueSort } from "./presentation/section-content";

/** The preview is compact: it never draws more than this many values, whatever `maxItems` says. */
export const DISCOVERY_PREVIEW_CAP = 12;

/** How a sample value's media is drawn. */
export type PreviewMedia = "picture" | "broken" | "initial" | "icon";

export interface PreviewValue {
  id: string;
  label: string;
  count: number;
  media: PreviewMedia;
  /** Sample picture index (selects one of the placeholder pictures); only for `picture`. */
  picture: number;
  icon: IconKey;
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

/** Looks cycled over a real facet's values (their names are real; their looks are samples). */
const REAL_VALUE_MEDIA: readonly PreviewMedia[] = ["picture", "picture", "broken", "picture", "icon", "initial"];
const REAL_VALUE_ICONS: readonly IconKey[] = ["flower", "gift", "heart", "sparkles", "star", "cake"];

export interface PreviewSource {
  /** `real`: names/counts from the loaded facet; `sample`: the built-in samples. */
  kind: "real" | "sample";
  values: PreviewValue[];
}

/** All values of the chosen dimension in merchant order (active only), or `null` when none can be used. */
function realValues(
  facets: readonly Facet[] | null,
  axis: "facet" | "brand",
  dimension: string,
  locale: CustomizerLocale,
): PreviewValue[] | null {
  if (axis !== "facet" || !facets || dimension === "") return null;
  const facet = facets.find((candidate) => candidate.key === dimension);
  if (!facet) return null;
  const active = facet.values.filter((value) => value.isActive);
  if (active.length === 0) return null;
  return [...active]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((value, index) => ({
      id: value.id,
      label: locale === "en" && value.nameEn ? value.nameEn : value.name,
      count: value.productCount,
      media: REAL_VALUE_MEDIA[index % REAL_VALUE_MEDIA.length],
      picture: index,
      icon: REAL_VALUE_ICONS[index % REAL_VALUE_ICONS.length],
    }));
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
  return real
    ? { kind: "real", values: real }
    : { kind: "sample", values: sampleValues(input.locale) };
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
