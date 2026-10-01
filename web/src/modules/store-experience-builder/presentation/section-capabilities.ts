import { MAX_HOME_SECTIONS, type PresentationHomeSection } from "./config";
import {
  HOME_BUILDER_SECTION_KEYS,
  type HomeBuilderSectionKey,
} from "./tokens";
import type { CustomizerMessageKey } from "../messages";

/**
 * STORE-CUSTOMIZER-V2-2 — Section Picker / Add / Duplicate capability model.
 *
 * CONTRACT-2 يسمح تقنيًا بأي (id, type) فريدة الـid، لكن الـUI لا يسمح
 * بالعمليات إلا ضمن هذه القواعد المركزية:
 *
 * - hero / categories / newArrivals / wholesale / appPromo: singleton
 *   (maxInstances = 1). السبب في hero: heroHeadline/heroSubheadline ما زالا
 *   global داخل homepage وليسا per-instance — لا Duplicate له أبدًا.
 * - banner / featured / offers / benefits / customContent: تعدد مسموح
 *   (maxInstances = null) بشرط id مستقل لكل instance.
 *
 * هذا النموذج UI-side فقط؛ الـnormalizers تبقى fail-closed كما هي ولا
 * تعتمد على هذه القواعد.
 *
 * CUST-H4-2 — formalized merchant-facing capability metadata (CUST-H4-ARCH-1
 * §5/§17), so the Section Library can render search/category/state/add
 * honestly from one registry instead of scattered conditionals
 * (`GATED_HOME_SECTION_KEYS`, ad hoc badges). `state` mirrors the H4
 * contract's truth matrix exactly — a PARTIAL section (`featured`) is never
 * flattened to LIVE, and a GATED one (`offers`) stays addable-with-honest-
 * copy exactly as it is today (`isGatedHomeSection`/`gatedSection`), not
 * silently hidden — H4-2 does not reinterpret that decision.
 */
export type SectionCapabilityState = "live" | "partial" | "gated" | "deferred";

/** Section Library taxonomy (CUST-H4-ARCH-1 §16) — every category below maps
 * to at least one section type, so none renders empty in the Library. */
export type SectionLibraryCategory =
  | "products"
  | "categoriesNavigation"
  | "offersMarketing"
  | "mediaVideo"
  | "content"
  | "trustServices"
  | "appCommunication";

export const SECTION_LIBRARY_CATEGORIES: readonly SectionLibraryCategory[] = [
  "products",
  "categoriesNavigation",
  "offersMarketing",
  "mediaVideo",
  "content",
  "trustServices",
  "appCommunication",
];

export const SECTION_LIBRARY_CATEGORY_LABEL: Record<
  SectionLibraryCategory,
  CustomizerMessageKey
> = {
  products: "sectionCategoryProducts",
  categoriesNavigation: "sectionCategoryCategoriesNav",
  offersMarketing: "sectionCategoryOffersMarketing",
  mediaVideo: "sectionCategoryMediaVideo",
  content: "sectionCategoryContent",
  trustServices: "sectionCategoryTrustServices",
  appCommunication: "sectionCategoryAppCommunication",
};

export interface SectionCapability {
  type: HomeBuilderSectionKey;
  /** null = بلا حد عددي للنوع (يبقى خاضعًا لـ MAX_HOME_SECTIONS). */
  maxInstances: number | null;
  canDuplicate: boolean;
  /** Hero content is global today, so deleting its instance would misleadingly preserve that content. */
  canDelete: boolean;
  /** Truth state per CUST-H4-ARCH-1 §5 — never flattened to "live". */
  state: SectionCapabilityState;
  /** Section Library taxonomy group (§16). */
  category: SectionLibraryCategory;
  /** False only for a type withheld from the Library's addable results entirely. None today — see module comment. */
  merchantAddable: boolean;
  /** Localized card/composer title. */
  titleKey: CustomizerMessageKey;
  /** Short, non-technical merchant-facing description for the Library card. */
  descriptionKey: CustomizerMessageKey;
  /** Shown on the Library card when state !== "live". */
  reasonKey?: CustomizerMessageKey;
}

export const SECTION_CAPABILITIES: Record<
  HomeBuilderSectionKey,
  SectionCapability
> = {
  hero: {
    type: "hero",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: false,
    state: "live",
    category: "mediaVideo",
    merchantAddable: true,
    titleKey: "sectionHero",
    descriptionKey: "sectionHeroDescription",
  },
  categories: {
    type: "categories",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: true,
    state: "live",
    category: "categoriesNavigation",
    merchantAddable: true,
    titleKey: "sectionCategories",
    descriptionKey: "sectionCategoriesDescription",
  },
  newArrivals: {
    type: "newArrivals",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: true,
    state: "live",
    category: "categoriesNavigation",
    merchantAddable: true,
    titleKey: "sectionNewArrivals",
    descriptionKey: "sectionNewArrivalsDescription",
  },
  wholesale: {
    type: "wholesale",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: true,
    state: "live",
    category: "offersMarketing",
    merchantAddable: true,
    titleKey: "sectionWholesale",
    descriptionKey: "sectionWholesaleDescription",
  },
  banner: {
    type: "banner",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    state: "live",
    category: "mediaVideo",
    merchantAddable: true,
    titleKey: "sectionBanner",
    descriptionKey: "sectionBannerDescription",
  },
  featured: {
    type: "featured",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    // CUST-H4-ARCH-1 §21 — real content/renderer/data source today; PARTIAL
    // only because the Content tab is a raw product-id text input (no real
    // picker yet, H4-5) and Published does an unbatched N+1 fetch. Never
    // flattened to LIVE per the H4 contract.
    state: "partial",
    category: "products",
    merchantAddable: true,
    titleKey: "sectionFeatured",
    descriptionKey: "sectionFeaturedDescription",
    reasonKey: "sectionFeaturedPartialReason",
  },
  offers: {
    type: "offers",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    // GATED today (CUST-H4-ARCH-1 §23) — target LIVE in H4-6/H4-7, not this
    // slice. Stays merchantAddable: true, matching today's actual behavior
    // (`isGatedHomeSection`/`gatedSection`) — a real, non-deceptive gate, not
    // a hidden one. H4-2 formalizes that existing honesty, it does not
    // reinterpret it.
    state: "gated",
    category: "offersMarketing",
    merchantAddable: true,
    titleKey: "sectionOffers",
    descriptionKey: "sectionOffersDescription",
    reasonKey: "gatedSection",
  },
  benefits: {
    type: "benefits",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    state: "live",
    category: "trustServices",
    merchantAddable: true,
    titleKey: "sectionBenefits",
    descriptionKey: "sectionBenefitsDescription",
  },
  appPromo: {
    type: "appPromo",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: true,
    state: "live",
    category: "appCommunication",
    merchantAddable: true,
    titleKey: "sectionAppPromo",
    descriptionKey: "sectionAppPromoDescription",
  },
  customContent: {
    type: "customContent",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    state: "live",
    category: "content",
    merchantAddable: true,
    titleKey: "sectionCustomContent",
    descriptionKey: "sectionCustomContentDescription",
  },
};

export function sectionCapability(
  type: HomeBuilderSectionKey,
): SectionCapability {
  return SECTION_CAPABILITIES[type];
}

/** Section types in the given Library category (empty for none — doesn't happen today). */
export function sectionTypesInCategory(
  category: SectionLibraryCategory,
): HomeBuilderSectionKey[] {
  return HOME_BUILDER_SECTION_KEYS.filter(
    (type) => SECTION_CAPABILITIES[type].category === category,
  );
}

/** هل يمكن إضافة instance جديد من هذا النوع الآن؟ */
export function canAddSectionType(
  sections: readonly PresentationHomeSection[],
  type: HomeBuilderSectionKey,
): boolean {
  if (sections.length >= MAX_HOME_SECTIONS) return false;
  const cap = SECTION_CAPABILITIES[type];
  if (!cap.merchantAddable) return false;
  if (cap.maxInstances === null) return true;
  const count = sections.filter((section) => section.type === type).length;
  return count < cap.maxInstances;
}

/** هل توجد أي إضافة متاحة أصلًا (لتعطيل زر الـPicker عند الحد)؟ */
export function hasAddableSectionType(
  sections: readonly PresentationHomeSection[],
): boolean {
  return HOME_BUILDER_SECTION_KEYS.some((type) =>
    canAddSectionType(sections, type),
  );
}

/** هل يمكن تكرار هذا الـinstance الآن؟ */
export function canDuplicateSection(
  sections: readonly PresentationHomeSection[],
  section: PresentationHomeSection,
): boolean {
  if (sections.length >= MAX_HOME_SECTIONS) return false;
  return SECTION_CAPABILITIES[section.type].canDuplicate;
}

/** هل يمكن حذف هذا الـinstance من واجهة الـCustomizer؟ */
export function canDeleteSection(section: PresentationHomeSection): boolean {
  return SECTION_CAPABILITIES[section.type].canDelete;
}

/**
 * هوية instance جديدة عند إنشاء المستخدم فقط (Add/Duplicate) — لا تُستخدم
 * أبدًا أثناء normalization أو القراءة. الصيغة `section-<uuid>` متوافقة مع
 * safeId في العقد: ‏/^[a-zA-Z0-9_-]{1,64}$/‏ (الطول 44).
 */
export function newHomeSectionId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : // احتياطي لبيئات اختبار بلا crypto.randomUUID — نفس نمط المشروع.
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  return `section-${uuid}`;
}
