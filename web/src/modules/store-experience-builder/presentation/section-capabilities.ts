import { MAX_HOME_SECTIONS, type PresentationHomeSection } from "./config";
import {
  HOME_BUILDER_SECTION_KEYS,
  type HomeBuilderSectionKey,
} from "./tokens";

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
 */
export interface SectionCapability {
  type: HomeBuilderSectionKey;
  /** null = بلا حد عددي للنوع (يبقى خاضعًا لـ MAX_HOME_SECTIONS). */
  maxInstances: number | null;
  canDuplicate: boolean;
}

export const SECTION_CAPABILITIES: Record<
  HomeBuilderSectionKey,
  SectionCapability
> = {
  hero: { type: "hero", maxInstances: 1, canDuplicate: false },
  categories: { type: "categories", maxInstances: 1, canDuplicate: false },
  newArrivals: { type: "newArrivals", maxInstances: 1, canDuplicate: false },
  wholesale: { type: "wholesale", maxInstances: 1, canDuplicate: false },
  banner: { type: "banner", maxInstances: null, canDuplicate: true },
  featured: { type: "featured", maxInstances: null, canDuplicate: true },
  offers: { type: "offers", maxInstances: null, canDuplicate: true },
  benefits: { type: "benefits", maxInstances: null, canDuplicate: true },
  appPromo: { type: "appPromo", maxInstances: 1, canDuplicate: false },
  customContent: {
    type: "customContent",
    maxInstances: null,
    canDuplicate: true,
  },
};

export function sectionCapability(
  type: HomeBuilderSectionKey,
): SectionCapability {
  return SECTION_CAPABILITIES[type];
}

/** هل يمكن إضافة instance جديد من هذا النوع الآن؟ */
export function canAddSectionType(
  sections: readonly PresentationHomeSection[],
  type: HomeBuilderSectionKey,
): boolean {
  if (sections.length >= MAX_HOME_SECTIONS) return false;
  const cap = SECTION_CAPABILITIES[type];
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
