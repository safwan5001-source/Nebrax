/**
 * AWJ-STORE-CAT-DESIGN-01 — starting presets for the categories section's card display.
 *
 * A preset is just a normalized `design.display`: applying one replaces ONLY that group of the section's design (the
 * layout, card, image and name settings). It can never touch the section's content — category source, order and links
 * are not part of a display — and it is an ordinary editor change, so the builder's undo/redo and "unsaved" state cover
 * it. Colours are theme tokens only, so a preset can never fail a contrast gate.
 */

import { type CategoryDisplay, normalizeDisplay } from "./presentation/section-design";
import { sameDisplay } from "./categories-display-edit";

export const CATEGORY_DISPLAY_PRESET_IDS = [
  "elegant_cards",
  "circular",
  "compact",
  "image_tiles",
] as const;
export type CategoryDisplayPresetId = (typeof CATEGORY_DISPLAY_PRESET_IDS)[number];

export interface CategoryDisplayPreset {
  id: CategoryDisplayPresetId;
  label: { ar: string; en: string };
  hint: { ar: string; en: string };
  display: CategoryDisplay;
}

const RAW: ReadonlyArray<Omit<CategoryDisplayPreset, "display"> & { raw: Record<string, unknown> }> = [
  {
    id: "elegant_cards",
    label: { ar: "بطاقات أنيقة", en: "Elegant cards" },
    hint: { ar: "شبكة بطاقات بإطار هادئ وصورة 4:3", en: "A card grid with a calm frame and 4:3 pictures" },
    raw: {
      layout: "grid",
      columns: { mobile: 2, tablet: 3, desktop: 6 },
      gap: { mobile: 12, tablet: 16, desktop: 16 },
      card: { style: "border", radius: 16, padding: 12, hover: "subtle" },
      image: { shape: "rect", aspect: "4:3", fit: "cover" },
      name: { placement: "below", align: "start", size: 14, weight: 700, lines: 2 },
    },
  },
  {
    id: "circular",
    label: { ar: "تصنيفات دائرية", en: "Circular categories" },
    hint: { ar: "صور دائرية قابلة للتمرير مع الاسم أسفلها", en: "Scrollable round pictures with the name underneath" },
    raw: {
      layout: "circles",
      gap: { mobile: 16, tablet: 20, desktop: 24 },
      itemWidth: { mobile: 88, tablet: 104, desktop: 120 },
      card: { style: "none" },
      image: { fit: "cover" },
      name: { placement: "below", align: "center", size: 13, weight: 600, lines: 2 },
    },
  },
  {
    id: "compact",
    label: { ar: "مضغوط", en: "Compact" },
    hint: { ar: "صفوف مدمجة: صورة صغيرة بجانب الاسم", en: "Dense rows: a small picture beside the name" },
    raw: {
      layout: "compact_list",
      columns: { mobile: 1, tablet: 2, desktop: 3 },
      gap: { mobile: 8, tablet: 8, desktop: 12 },
      card: { style: "border", radius: 12, padding: 8 },
      image: { shape: "square", fit: "cover" },
      name: { placement: "beside", align: "start", size: 14, weight: 600, lines: 1 },
    },
  },
  {
    id: "image_tiles",
    label: { ar: "بلاط صور", en: "Image tiles" },
    hint: { ar: "الصورة هي البطاقة والاسم فوقها على خلفية مقروءة", en: "The picture is the card; the name sits over it on a readable backing" },
    raw: {
      layout: "image_tiles",
      columns: { mobile: 2, tablet: 3, desktop: 4 },
      gap: { mobile: 12, tablet: 12, desktop: 16 },
      card: { style: "none", radius: 16 },
      image: { aspect: "4:3", fit: "cover" },
      name: { placement: "overlay", align: "center", size: 16, weight: 700, lines: 2, background: "scrim" },
    },
  },
];

export const CATEGORY_DISPLAY_PRESETS: readonly CategoryDisplayPreset[] = RAW.map(
  ({ raw, ...meta }) => ({ ...meta, display: normalizeDisplay(raw) as CategoryDisplay }),
);

export function presetById(id: CategoryDisplayPresetId): CategoryDisplayPreset {
  return CATEGORY_DISPLAY_PRESETS.find((preset) => preset.id === id) as CategoryDisplayPreset;
}

/** The preset a display is exactly equal to, or `null` (customised or classic). */
export function matchingPreset(display: CategoryDisplay | undefined): CategoryDisplayPresetId | null {
  if (!display) return null;
  return CATEGORY_DISPLAY_PRESETS.find((preset) => sameDisplay(preset.display, display))?.id ?? null;
}
