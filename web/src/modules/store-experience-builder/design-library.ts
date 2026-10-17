/**
 * AWJ Store Design Library — Phase 1.
 *
 * The library is deliberately a catalogue of presets over the existing
 * presentation contract. It does not introduce a parallel document model:
 * global entries write the existing product-card tokens and section entries
 * write the existing, type-gated `section.design` object. Running every
 * section preset through `normalizeSectionDesign` keeps the catalogue inside
 * the same closed allow-list used by drafts, publishing and the storefront.
 */

import type { GlobalCards } from "./presentation/global-tokens";
import {
  normalizeSectionDesign,
  type SectionDesign,
} from "./presentation/section-design";
import type { HomeBuilderSectionKey } from "./presentation/tokens";

export const DESIGN_LIBRARY_CATEGORIES = [
  "products",
  "categories",
  "promotions",
  "featured",
  "content",
] as const;

export type DesignLibraryCategory =
  (typeof DESIGN_LIBRARY_CATEGORIES)[number];

interface DesignLibraryBase {
  id: string;
  category: DesignLibraryCategory;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
}

export interface GlobalDesignLibraryVariant extends DesignLibraryBase {
  scope: "global";
  productCard: "standard" | "compact";
  cards: GlobalCards;
}

export interface SectionDesignLibraryVariant extends DesignLibraryBase {
  scope: "section";
  sectionType: HomeBuilderSectionKey;
  design: SectionDesign;
}

export type DesignLibraryVariant =
  | GlobalDesignLibraryVariant
  | SectionDesignLibraryVariant;

function sectionVariant(
  value: Omit<SectionDesignLibraryVariant, "scope" | "design"> & {
    design: Record<string, unknown>;
  },
): SectionDesignLibraryVariant {
  const design = normalizeSectionDesign(value.sectionType, value.design);
  if (!design) {
    throw new Error(`Invalid design-library variant: ${value.id}`);
  }
  return { ...value, scope: "section", design };
}

/**
 * Six visually distinct, useful starting points across five requested
 * categories. Product-page image galleries are intentionally not included in
 * Phase 1: their current contract only supports ordering/visibility and zoom,
 * not a safe selectable layout variant.
 */
export const DESIGN_LIBRARY_VARIANTS: readonly DesignLibraryVariant[] = [
  {
    id: "product-editorial",
    scope: "global",
    category: "products",
    name: { ar: "بطاقات تحريرية", en: "Editorial product cards" },
    description: {
      ar: "صور طولية، محاذاة وسطية وارتفاع لطيف عند المرور.",
      en: "Portrait imagery, centered details and a gentle lift on hover.",
    },
    productCard: "standard",
    cards: {
      align: "center",
      imageRatio: "3:4",
      imageFit: "cover",
      hover: "lift",
    },
  },
  sectionVariant({
    id: "categories-orbit",
    category: "categories",
    sectionType: "categories",
    name: { ar: "تصنيفات دائرية", en: "Circular collections" },
    description: {
      ar: "صف دائري مرن مناسب للتصفح السريع على الجوال.",
      en: "A responsive circle-led layout for fast mobile browsing.",
    },
    design: {
      display: {
        layout: "circles",
        columns: { mobile: 3, tablet: 4, desktop: 6 },
        gap: { mobile: 12, tablet: 16, desktop: 20 },
        card: { style: "none", padding: 0, hover: "subtle" },
        image: { shape: "circle", aspect: "1:1", fit: "cover" },
        name: {
          placement: "below",
          align: "center",
          weight: 700,
          lines: 1,
        },
      },
      spacing: { top: "md", bottom: "md" },
    },
  }),
  sectionVariant({
    id: "categories-showcase",
    category: "categories",
    sectionType: "categories",
    name: { ar: "واجهات التصنيفات", en: "Category showcases" },
    description: {
      ar: "بلاطات صور عريضة بعناوين متراكبة للمتاجر البصرية.",
      en: "Wide image tiles with overlaid names for visual catalogues.",
    },
    design: {
      display: {
        layout: "image_tiles",
        columns: { mobile: 2, tablet: 3, desktop: 4 },
        gap: { mobile: 8, tablet: 12, desktop: 16 },
        card: { style: "none", radius: 16, padding: 0, hover: "subtle" },
        image: { shape: "rect", aspect: "4:3", fit: "cover" },
        name: {
          placement: "overlay",
          align: "start",
          weight: 800,
          lines: 2,
          background: "scrim",
        },
      },
      spacing: { top: "md", bottom: "md" },
    },
  }),
  sectionVariant({
    id: "banner-split",
    category: "promotions",
    sectionType: "banner",
    name: { ar: "عرض منقسم", en: "Split promotion" },
    description: {
      ar: "رسالة وصورة جنباً إلى جنب مع إطار بارز ومتجاوب.",
      en: "Side-by-side message and media in a responsive framed feature.",
    },
    design: {
      layout: "split",
      width: { mode: "contained", max: "wide" },
      spacing: { top: "md", bottom: "md", inner: "lg" },
      align: "start",
      valign: "center",
      radius: "lg",
      shadow: "soft",
      mediaTreatment: { height: "standard" },
    },
  }),
  sectionVariant({
    id: "featured-rail",
    category: "featured",
    sectionType: "featured",
    name: { ar: "مختارات قابلة للسحب", en: "Swipeable featured shelf" },
    description: {
      ar: "شريط منتجات أفقي ببطاقات طولية وحركة خفيفة.",
      en: "A horizontal product rail with portrait cards and subtle lift.",
    },
    design: {
      layout: "rail",
      spacing: { top: "lg", bottom: "lg" },
      typography: { headingStyle: "underline" },
      cards: {
        align: "start",
        imageRatio: "3:4",
        imageFit: "cover",
        hover: "lift",
      },
    },
  }),
  sectionVariant({
    id: "gallery-story",
    category: "content",
    sectionType: "gallery",
    name: { ar: "معرض قصصي", en: "Story gallery" },
    description: {
      ar: "شريط صور قابل للسحب مع إطار ناعم ومساحة عرض واسعة.",
      en: "A swipeable image story with a soft frame and wide canvas.",
    },
    design: {
      layout: "carousel",
      width: { mode: "wide", max: "wide" },
      spacing: { top: "lg", bottom: "lg", inner: "sm" },
      radius: "lg",
      shadow: "soft",
    },
  }),
] as const;

export function designLibraryVariant(
  id: string,
): DesignLibraryVariant | undefined {
  return DESIGN_LIBRARY_VARIANTS.find((variant) => variant.id === id);
}
