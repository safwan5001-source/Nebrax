import { MAX_HOME_SECTIONS, type PresentationHomeSection } from "./config";
import {
  ALL_HOME_SECTION_KEYS,
  type HomeBuilderSectionKey,
} from "./tokens";
import type { CustomizerMessageKey } from "../messages";

/**
 * STORE-CUSTOMIZER-V2-2 — Section Picker / Add / Duplicate capability model.
 *
 * CONTRACT-2 يسمح تقنيًا بأي (id, type) فريدة الـid، لكن الـUI لا يسمح
 * بالعمليات إلا ضمن هذه القواعد المركزية:
 *
 * - categories / newArrivals / wholesale / appPromo: singleton
 *   (maxInstances = 1).
 * - hero: لكل instance منذ CUST-HV V6a (V0 §8.1): قابل للحذف والتكرار حتى
 *   `maxInstances = 3` (Banner/Slider تغطيان الأشرطة الإضافية)؛ محتواه على الـinstance
 *   وبلا محتوى يقرأ النص القديم heroHeadline/heroSubheadline.
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
 * contract's truth matrix exactly — a non-LIVE section is never flattened
 * to LIVE until its real gap is actually closed (`featured` was PARTIAL
 * until CUST-H4-5 shipped its real picker + batched read; `offers` was GATED
 * until CUST-H4-6 shipped the Commerce backend and CUST-H4-7 shipped its
 * real picker, Canvas and Published renderers).
 *
 * Every section type is now LIVE and merchant-addable. The `partial`/`gated`/
 * `deferred` states and `reasonKey` remain in the model for any future
 * section that ships before its real gap is closed — none uses them today.
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
  /** Whether the instance can be removed from the Customizer (every type, hero included since V6a). */
  canDelete: boolean;
  /** Truth state per CUST-H4-ARCH-1 §5 — never flattened to "live". */
  state: SectionCapabilityState;
  /** Section Library taxonomy group (§16). */
  category: SectionLibraryCategory;
  /**
   * False for a type withheld from the Library's addable results entirely
   * (visible, disabled, `reasonKey` explains why — never hidden). Every type
   * is `true` today (`offers` flipped in CUST-H4-7).
   */
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
    // CUST-HV V6a (V0 §8.1.1) — per-instance, bounded.
    maxInstances: 3,
    canDuplicate: true,
    canDelete: true,
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
    // CUST-H4-5 — LIVE: a real merchant multi-select picker replaces the
    // old raw product-id text input, real Commerce product data hydrates
    // both the picker's selected chips and the Canvas preview (one batched
    // `ids[]` read per section instance, not per product), Published's
    // `FeaturedShelf` resolves the same way (one batched read replacing the
    // prior N unbatched `fetchProduct` calls), and the merchant-authored
    // `productIds` order is the single display-order authority on both
    // Canvas and Published. No `reasonKey` — LIVE sections never carry one.
    state: "live",
    category: "products",
    merchantAddable: true,
    titleKey: "sectionFeatured",
    descriptionKey: "sectionFeaturedDescription",
  },
  offers: {
    type: "offers",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    // CUST-H4-7 — LIVE end-to-end on the real H4-6 Commerce source: a typed
    // `OffersContent{offerIds}` (references only), a real merchant picker over
    // the configured Offers (one shared workspace read), a real Canvas card
    // that renders only server-evaluated live offers, and a real Published
    // `OffersShelf` reading the Host-resolved `GET /store/v1/offers`. Price,
    // discount and live status stay Commerce authority on both surfaces; the
    // merchant-authored `offerIds` order is the single display-order authority.
    // No `reasonKey` — LIVE sections never carry one.
    state: "live",
    category: "offersMarketing",
    merchantAddable: true,
    titleKey: "sectionOffers",
    descriptionKey: "sectionOffersDescription",
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
  // FLOWERS-H9 / ADR-21 — data-backed sections (read live by the storefront).
  productShelf: {
    type: "productShelf",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    state: "live",
    category: "products",
    merchantAddable: true,
    titleKey: "sectionProductShelf",
    descriptionKey: "sectionProductShelfDescription",
  },
  discovery: {
    type: "discovery",
    maxInstances: null,
    canDuplicate: true,
    canDelete: true,
    state: "live",
    category: "categoriesNavigation",
    merchantAddable: true,
    titleKey: "sectionDiscovery",
    descriptionKey: "sectionDiscoveryDescription",
  },
  deliveryPromise: {
    type: "deliveryPromise",
    maxInstances: 1,
    canDuplicate: false,
    canDelete: true,
    state: "live",
    category: "trustServices",
    merchantAddable: true,
    titleKey: "sectionDeliveryPromise",
    descriptionKey: "sectionDeliveryPromiseDescription",
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
  return ALL_HOME_SECTION_KEYS.filter(
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
  return ALL_HOME_SECTION_KEYS.some((type) =>
    canAddSectionType(sections, type),
  );
}

/** هل يمكن تكرار هذا الـinstance الآن؟ */
export function canDuplicateSection(
  sections: readonly PresentationHomeSection[],
  section: PresentationHomeSection,
): boolean {
  if (sections.length >= MAX_HOME_SECTIONS) return false;
  const cap = SECTION_CAPABILITIES[section.type];
  if (!cap.canDuplicate) return false;
  // A duplicate is one more instance: it must respect the type's own bound too (hero ≤ 3).
  if (cap.maxInstances === null) return true;
  return (
    sections.filter((entry) => entry.type === section.type).length <
    cap.maxInstances
  );
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
