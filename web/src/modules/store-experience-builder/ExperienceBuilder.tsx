"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ScrollIndicator } from "./ScrollIndicator";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  defaultProductPageRegions,
  type HomeBuilderSectionKey,
  moveProductRegion,
  normalizePresentationConfig,
  type PageRegionInstance,
  type PageType,
  type ProductPageRegionKey,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "./presentation";
import { ProductPreviewPicker } from "./ProductPreviewPicker";
import { ProductPreviewPickerPanel } from "./ProductPreviewPickerPanel";
import { ProductRegionInspector } from "./ProductRegionInspector";
import {
  listWorkspaceProducts,
  showWorkspaceProduct,
  type WorkspaceProductDetail,
  type WorkspaceProductSummary,
} from "@/modules/commerce-workspace/workspace-products";
import { DRAFT_PERSISTENCE_CAPABILITY, PUBLISH_CAPABILITY } from "./presentation/capabilities";
import {
  ControlPanels,
  CUSTOMIZER_NAV_GROUPS,
  CUSTOMIZER_PANELS,
  type CustomizerPanel,
} from "./ControlPanels";
import {
  type CustomizerLocale,
  type CustomizerMessageKey,
  customizerMessage,
} from "./messages";
import {
  type PreviewChromeTarget,
  StorefrontPreviewCanvas,
  type StorefrontBusinessIdentity,
} from "./StorefrontPreviewCanvas";
import { VersionSelector } from "./VersionSelector";
import { PageNavigator } from "./PageNavigator";
import { PageIcon, PageNavigatorPanel, pageLabelKey } from "./PageNavigatorPanel";
import {
  VersionManagerPanel,
  type VersionManagerListState,
  type VersionManagerPanelProps,
} from "./VersionManagerPanel";
import {
  cancelPresentationVersionSchedule,
  createPresentationVersion,
  deletePresentationVersion,
  listPresentationVersions,
  type PresentationVersionDetail,
  type PresentationVersionSummary,
  publishPresentationVersion,
  renamePresentationVersion,
  savePresentationVersion,
  schedulePresentationVersion,
  showPresentationVersion,
} from "@/modules/commerce-workspace/presentation-versions";
import { useCompany } from "@/lib/company";
import { safeTimeZone } from "@/lib/timezone";
import { CancelScheduleConfirmDialog, ScheduleConfirmDialog } from "./ScheduleDialogs";

export const PREVIEW_WIDTHS = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
} as const;

export const STORE_BUILDER_SIDEBAR_STORAGE_KEY =
  "awj-store-builder-sidebar-collapsed";

export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

export type BuilderLifecycle =
  | "clean"
  | "dirty"
  | "save_blocked"
  | "publish_blocked";

type MobileSheet =
  | "sections"
  | "settings"
  | "design"
  | "versions"
  | "pages"
  | "product-picker"
  | null;

interface ExperienceBuilderProps {
  initialConfig?: StorefrontPresentationConfig;
  liveStoreName?: string | null;
  businessIdentity?: StorefrontBusinessIdentity;
  initialLocale?: CustomizerLocale;
  storefrontId?: string | null;
  storefrontUrl?: string | null;
  versionId?: string | null;
}

export function ExperienceBuilder({
  initialConfig,
  liveStoreName = null,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  initialLocale = "ar",
  storefrontId = null,
  storefrontUrl = null,
  versionId = null,
}: ExperienceBuilderProps) {
  const seed = normalizePresentationConfig(
    initialConfig ?? DEFAULT_PRESENTATION_CONFIG,
  );
  const [saved, setSaved] = useState<StorefrontPresentationConfig>(seed);
  const [draft, setDraft] = useState<StorefrontPresentationConfig>(seed);
  const locale: CustomizerLocale = initialLocale;
  const [panel, setPanel] = useState<CustomizerPanel>("theme");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("preview");
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [builderSidebarCollapsed, setBuilderSidebarCollapsed] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectedChrome, setSelectedChrome] =
    useState<PreviewChromeTarget | null>(null);
  // CUST-H2-2 — أي صفحة متجر (رئيسية/منتج/تصنيف) يُعايِنها المحرِّر الآن.
  // حالة محرِّر محلية بحتة: لا تُخزَّن في `pagePresentation`، لا تُرسَل مع
  // الحفظ/النشر، ولا تُغيِّر سلطة الاستحقاق التجاري لمنتج/تصنيف — تجيب فقط
  // «أي صفحة أعرض؟»، منفصلة تماماً عن `selectedVersion` («أي نسخة أُعدِّل؟»).
  const [currentPage, setCurrentPage] = useState<PageType>("home");
  // CUST-H2-3 — أي منتج يُعايِن المحرِّر حالياً في صفحة المنتج. **سياق محرِّر
  // بحت**: لا يُكتَب أبداً إلى `pagePresentation`، لا يُرسَل مع الحفظ/النشر،
  // ولا يُغيِّر `dirty`/`lifecycle` (راجع العقد المعماري، "Preview Context
  // Model" — يجيب «أي منتج أُعايِن؟» لا «لأي منتج هذا التخطيط؟»).
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [previewProduct, setPreviewProduct] =
    useState<WorkspaceProductDetail | null>(null);
  const [previewProductState, setPreviewProductState] = useState<
    "idle" | "loading" | "error" | "empty" | "ready"
  >("idle");
  const [productList, setProductList] = useState<WorkspaceProductSummary[]>([]);
  const [productListState, setProductListState] = useState<
    "idle" | "loading" | "error" | "ready"
  >("idle");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductRegion, setSelectedProductRegion] = useState<string | null>(null);
  // هويتا طلبٍ مستقلَّتان (نفس نمط `versionRequestTokenRef`) — تمنعان نتيجة
  // شبكة متأخرة (قائمة منتجات أو تفصيل منتج) من الكتابة فوق حالة أحدث بعد
  // تبديل سريع للمتجر أو لمنتج المعاينة نفسه.
  const productListRequestRef = useRef(0);
  const previewProductRequestRef = useRef(0);
  const [pendingSectionScroll, setPendingSectionScroll] = useState<
    string | null
  >(null);
  const [lifecycle, setLifecycle] = useState<BuilderLifecycle>("clean");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"capability" | "status">("status");
  const [busy, setBusy] = useState<"loading" | "saving" | null>(
    storefrontId ? "loading" : null,
  );

  // CUST-H1-2 — نسخ التصميم. القائمة والحالة المشتقة من الخادم حصراً
  // (`StorefrontPresentationVersionService::deriveState`)؛ لا نموذج حالة
  // محلي. `versionRequestTokenRef` يمنع نتيجة متأخرة من نسخة سابقة (A) من
  // الكتابة فوق حالة نسخة لاحقة (B) بعد تبديل سريع بينهما (§28).
  const [versionsListState, setVersionsListState] =
    useState<VersionManagerListState>(storefrontId ? "loading" : "ready");
  const [versions, setVersions] = useState<PresentationVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] =
    useState<PresentationVersionDetail | null>(null);
  const [versionSwitchingId, setVersionSwitchingId] = useState<string | null>(null);
  const [versionCreating, setVersionCreating] = useState(false);
  const [versionBusy, setVersionBusy] = useState<
    { id: string; action: "duplicate" | "rename" | "delete" | "publish" | "schedule" | "cancel_schedule" } | null
  >(null);
  const [versionConflict, setVersionConflict] = useState<{ versionId: string } | null>(null);
  // CUST-H1-3 — النشر الفوري لنسخة محدَّدة. حوارٌ صريح دوماً قبل أي طلب
  // شبكة فعلي (لا نشر بضغطة واحدة) — `publishTarget` يحمل الصفّ المطلوب
  // نشره (من الشريط العلوي أو من صفّ في إدارة النسخ)، لا `selectedVersion`
  // بالضرورة: النشر من صفٍّ في المدير لا يستلزم أن تكون تلك النسخة مفتوحة
  // في المحرِّر أصلاً.
  const [publishTarget, setPublishTarget] = useState<PresentationVersionSummary | null>(null);
  // CUST-H1-5 — جدولة/إعادة جدولة نسخة محدَّدة. نفس نمط `publishTarget` تماماً:
  // حوارٌ صريح، ولا يفترض أن تكون النسخة مفتوحة في المحرِّر. `mode` يميّز
  // النصّ/الزر فقط — الخادم يعامل الحالتين كمعاملة واحدة (`scheduleForCurrentTenant`).
  const [scheduleTarget, setScheduleTarget] = useState<
    { version: PresentationVersionSummary; mode: "schedule" | "reschedule" } | null
  >(null);
  // CUST-H1-5 — تأكيد إلغاء الجدولة. إجراء دورة حياة منفصل عن الحذف العام
  // (راجع تعليق `CancelScheduleConfirmDialog`) — يحتاج حوار تأكيد خاصاً به.
  const [cancelScheduleTarget, setCancelScheduleTarget] = useState<PresentationVersionSummary | null>(null);
  // CUST-H1-5 — التوقيت الزمني المعتمَد الوحيد لعرض/تحويل مواعيد الجدولة
  // (`tenants.timezone` عبر `/me` → `company.timezone`؛ راجع `lib/timezone.ts`
  // لتفصيل لماذا لا يُعتمَد توقيت المتصفح إطلاقاً). `useCompany()` نفس الخطّاف
  // الذي تستهلكه بقية القشرة لهذه البيانات — لا مسار جلب جديد.
  const company = useCompany();
  const tenantTimezone = safeTimeZone(company?.timezone);
  const versionRequestTokenRef = useRef(0);
  // هويتا طلب مخصَّصتان لعلَمَي الانشغال (`versionCreating`/`versionBusy`) —
  // منفصلتان عمداً عن `versionRequestTokenRef` أعلاه: ذاك يزيد أيضاً عند مجرَّد
  // تبديل نسخة (لا إنشاء/كتابة جديدة)، فلو استُعمل لتصفير علَم إنشاءٍ قيد
  // التنفيذ لبقي عالقاً `true` إلى الأبد إن بدَّل التاجر النسخة المفتوحة أثناء
  // انتظاره بلا بدء إنشاء آخر. كل مرجع هنا يزيد فقط عند بدء العملية التي يخصّها
  // فعلاً، فيميّز «هل ما زلتُ أحدث إنشاء/كتابة صفّ لهذا المتجر» بمعزل عن أي
  // تبديل نسخة غير ذي صلة وقع في الأثناء.
  const versionCreateRequestRef = useRef(0);
  const versionWriteRequestRef = useRef(0);
  // مرجع متزامن لقيمة `storefrontId` الحالية — يُحدَّث كل تصيير بلا Effect، ليتيح
  // لإغلاقات غير متزامنة (نتائج شبكة متأخرة لحفظ/تسمية/إنشاء/حذف/قائمة) معرفة
  // هل ما زال المتجر نفسه معروضاً حين تصل، بمعزل عن القيمة التي أُغلِق عليها
  // الإغلاق وقت بدء الطلب. `versionRequestTokenRef` وحده يكفي لتبديل *نسخة*
  // داخل المتجر نفسه؛ هذا يميّز أيضاً تبديل *المتجر* نفسه، وهو ما يحسم هل تحديث
  // صفّ في `versions` ما زال ينتمي للقائمة المعروضة أصلاً.
  const storefrontIdRef = useRef(storefrontId);
  storefrontIdRef.current = storefrontId;
  // مرجع متزامن مماثل لـ`draft` — يتيح لمعالج نجاح الحفظ معرفة هل عدَّل التاجر
  // المسودة مجدداً بعد إرسال الـ`PUT` وقبل وصول استجابته، فلا يُستبدَل تعديله
  // الأحدث بلقطة الخادم القديمة (راجع `handleSave`).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // مرجع متزامن مماثل لهوية `selectedVersion` — يتيح لمعالج نجاح التسمية
  // (وأي معالج مشابه لاحقاً) معرفة هل ما زالت النسخة التي بدأ يُعيد تسميتها
  // هي المفتوحة فعلياً الآن، لا مجرَّد أن الرمز العام لم يتغيَّر أثناء *مدة
  // طلبه هو*. تبديلٌ إلى نسخة أخرى قد يبدأ *قبل* هذا الطلب (فيزيد الرمز
  // مبكراً) ويكتمل أثناء انتظاره — عندها `stillCurrent` وحدها لا تكتشف شيئاً
  // (رمز الطلب لم يتغيَّر منذ بدء *هذا* الطلب تحديداً)، فيُخاطر بتبنّي نتيجة
  // التسمية على `selectedVersion` رغم أن `draft`/`saved` أصبحا يخصّان نسخة
  // أخرى تماماً.
  const selectedVersionIdRef = useRef<string | null>(selectedVersion?.id ?? null);
  selectedVersionIdRef.current = selectedVersion?.id ?? null;

  function stillCurrent(originStorefrontId: string | null, tokenAtStart: number): boolean {
    return storefrontIdRef.current === originStorefrontId && tokenAtStart === versionRequestTokenRef.current;
  }

  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  const dirty = !presentationConfigsEqual(draft, saved);
  // CUST-H2-2 — لوحة "homepage" (أقسام الصفحة الرئيسية) صالحة على الرئيسية
  // فقط؛ اللوحات الأخرى كلها هوية/تصميم/تواصل عالمية تصلح لكل صفحة (راجع
  // "Global vs Page-Specific Matrix" في العقد المعماري). إخفاؤها من التنقّل
  // بدل تعطيلها يمنع عرض عناصر تحكم الرئيسية على صفحة خاطئة دون اختراع حالة
  // "معطَّلة" جديدة.
  // CUST-H2-3 — نفس منطق إخفاء "homepage" أعلاه بالضبط، معكوساً: لوحة "product"
  // صالحة على صفحة المنتج فقط.
  const visibleNavGroups = CUSTOMIZER_NAV_GROUPS.map((group) => ({
    items: group.items.filter(
      (item) =>
        (item.id !== "homepage" || currentPage === "home")
        && (item.id !== "product" || currentPage === "product"),
    ),
  })).filter((group) => group.items.length > 0);
  const visiblePanels = CUSTOMIZER_PANELS.filter(
    (item) =>
      (item.id !== "homepage" || currentPage === "home")
      && (item.id !== "product" || currentPage === "product"),
  );
  const activePanel = CUSTOMIZER_PANELS.find((item) => item.id === panel);
  const isPublishedReadOnly = selectedVersion?.state === "published";
  const candidateVersions = versions.filter((v) => v.state !== "published");
  // بلا `storefrontId` لا يوجد شيء يُحمَّل أو يُحفَظ (سلوك سابق للتحرير المحلي
  // البحت عبر `initialConfig` — يبقى كما هو حرفياً)، فبوابات النسخ لا تنطبق.
  const ambiguousChoice =
    Boolean(storefrontId) &&
    versionsListState === "ready" &&
    selectedVersion === null &&
    versionSwitchingId === null &&
    candidateVersions.length > 1;
  const noVersionsYet =
    Boolean(storefrontId) &&
    versionsListState === "ready" &&
    versions.length === 0 &&
    selectedVersion === null &&
    versionSwitchingId === null;

  useEffect(() => {
    const updateViewport = () => setIsMobileViewport(window.innerWidth < 768);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem(
        STORE_BUILDER_SIDEBAR_STORAGE_KEY,
      );
      if (persisted === "true" || persisted === "false") {
        setBuilderSidebarCollapsed(persisted === "true");
      }
    } catch {
      // Browser storage can be unavailable; expanded is the safe default.
    } finally {
      setSidebarPreferenceLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded) return;
    try {
      window.localStorage.setItem(
        STORE_BUILDER_SIDEBAR_STORAGE_KEY,
        String(builderSidebarCollapsed),
      );
    } catch {
      // The preference is best-effort and must never block the builder.
    }
  }, [builderSidebarCollapsed, sidebarPreferenceLoaded]);

  async function loadVersionList(): Promise<PresentationVersionSummary[] | null> {
    if (!storefrontId) return null;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    setVersionsListState("loading");
    const result = await listPresentationVersions(storefrontId);
    if (!stillCurrent(originStorefrontId, tokenAtStart)) {
      // فات أوانها: متجر أو نسخة أحدث تولّت العرض أثناء هذا الطلب — لا تُكتب
      // فوق حالتها (كانت هذه الكتابة تسبق فحص `cancelled` في المستدعي، فتُصيب
      // `versions` بصفّ متجر آخر رغم أن المستدعي يتجاهل النتيجة لاحقاً).
      // العملية المتفوّقة (تبنّي نسخة جديدة، مثلاً) لا تُصفِّر حالة تحميل هذه
      // القائمة بالضرورة — تبقى عالقة على "loading" إلى الأبد بلا حتى وسيلة
      // إعادة محاولة (تلك تظهر فقط لحالة "error")، رغم أن لا طلب فعلي قيد
      // التنفيذ بعد الآن. الاستقرار إلى "ready" هنا آمن: لم نكتب فوق `versions`
      // أعلاه، وإن كان لا يزال المتجر نفسه ولا تزال الحالة "loading" فعلاً (لم
      // يُسوِّها استدعاءٌ آخر أحدث بالفعل) فلا ضرر من إنهائها.
      if (storefrontIdRef.current === originStorefrontId) {
        setVersionsListState((current) => (current === "loading" ? "ready" : current));
      }
      return null;
    }
    if (!result.ok) {
      setVersionsListState("error");
      return null;
    }
    setVersions(result.data);
    setVersionsListState("ready");
    return result.data;
  }

  function toSummary(detail: PresentationVersionDetail): PresentationVersionSummary {
    return {
      id: detail.id,
      storefrontId: detail.storefrontId,
      name: detail.name,
      state: detail.state,
      schemaVersion: detail.schemaVersion,
      revision: detail.revision,
      scheduledFor: detail.scheduledFor,
      lastPublishedAt: detail.lastPublishedAt,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      publishedRevision: detail.publishedRevision,
      scheduleToken: detail.scheduleToken,
      schedulingRuntimeActive: detail.schedulingRuntimeActive,
    };
  }

  function updateVersionSummaryInList(detail: PresentationVersionDetail) {
    const summary = toSummary(detail);
    setVersions((prev) => {
      const exists = prev.some((v) => v.id === summary.id);
      return exists
        ? prev.map((v) => (v.id === summary.id ? summary : v))
        : [...prev, summary];
    });
  }

  // النقطة الوحيدة التي تجلب مستند نسخة فعلياً وتطبّقه على المحرِّر. لا حرس
  // تكافؤ ولا تأكيد تجاهل هنا عمداً — `selectVersion` (الاختيار العادي)
  // يضيفهما، بينما `reloadConflictedVersion` (§15) يحتاج تجاوزهما معاً.
  async function applyVersionSelection(target: { id: string }) {
    if (!storefrontId) return;
    const token = ++versionRequestTokenRef.current;
    const draftAtSwitchStart = draft;
    setVersionSwitchingId(target.id);
    // لا نصفّر بانر التعارض هنا: هذا الدالة تُستدعى أيضاً من
    // `reloadConflictedVersion`، وتصفيره الآن — قبل نجاح الجلب — يُسقط الحماية
    // بالضبط في الحالة التي وُجدت لأجلها: فشل هذا الجلب، أو نجاحه بعد تعديلٍ
    // محلي جديد (الفرع أدناه الذي لا يتبنّى النتيجة). يُصفَّر فقط أسفله عند
    // تبنّي المستند المجلوب فعلياً.
    setBusy("loading");
    setNoticeKind("status");
    setNotice(t("versionDetailLoading"));
    const result = await showPresentationVersion(storefrontId, target.id);
    if (token !== versionRequestTokenRef.current) return; // نسخة أحدث تجاوزت هذا الطلب
    setVersionSwitchingId(null);
    setBusy(null);
    if (!result.ok) {
      setNoticeKind("status");
      setNotice(
        result.reason === "unsupported_schema"
          ? t("versionUnsupportedSchema")
          : t("versionListLoadError"),
      );
      return;
    }
    // لوحة التحكم تبقى قابلة للتحرير أثناء انتظار هذا التحميل (لا حظر تحرير
    // أثناء التبديل) — تعديلٌ جديد على النسخة المفتوحة حالياً في هذه الأثناء
    // لا يبدّل الرمز (لا تبديل نسخة ولا متجر وقع)، فالفحص أعلاه وحده لا
    // يكتشفه. لا نستبدل هذا التعديل الأحدث بصمت بمحتوى الهدف؛ صفّه في القائمة
    // يُحدَّث فقط، وتبقى النسخة المفتوحة كما هي حتى يقرر التاجر مصير تعديله.
    // هذا يحمي `reloadConflictedVersion` أيضاً بلا أي استثناء: `draftAtSwitchStart`
    // تلتقط الحالة المحلية القديمة وقت الضغط على «تحديث النسخة» (وهي بالضبط
    // ما يُفترض أن يُهمَلها الإعلان الصريح بالتحديث)، فإن لم يتغيّر شيء أثناء
    // الانتظار يُستبدَل ذلك القديم بأمان؛ أمّا تعديل جديد وقع *بعد* الضغط
    // وأثناء الانتظار فيُصان بنفس الفحص، بلا حاجة لتجاوزٍ منفصل قد يُصيبه هو
    // الآخر بصمت.
    if (!presentationConfigsEqual(draftRef.current, draftAtSwitchStart)) {
      // الطلب نجح واكتمل فعلياً (busy/versionSwitchingId صُفِّرا أعلاه بالفعل)
      // — لكن هذا الفرع لا يتبنّى نتيجته. تنبيه «جارٍ تحميل التفاصيل» المضبوط
      // في بداية الدالة يبقى معروضاً بصمت إلى الأبد إن لم يُصفَّر هنا أيضاً،
      // رغم أن لا شيء قيد التحميل فعلياً بعد الآن.
      setNotice(null);
      updateVersionSummaryInList(result.data);
      return;
    }
    setNotice(null);
    setVersionConflict(null);
    setSelectedVersion(result.data);
    setDraft(result.data.config);
    setSaved(result.data.config);
    setLifecycle("clean");
    setSelectedSection(null);
    setSelectedChrome(null);
    updateVersionSummaryInList(result.data);
  }

  function selectVersion(target: PresentationVersionSummary) {
    if (selectedVersion?.id === target.id) {
      // النسخة نفسها مفتوحة أصلاً فظاهرياً لا شيء يلزم فعله — لكن تبديلاً
      // إلى نسخة *أخرى* قد يكون لا يزال معلَّقاً (بدأه التاجر ثم عاد وفتح هذا
      // الصفّ نفسه عدولاً عنه). إبطاله صراحةً هنا يمنع اكتماله لاحقاً بصمت
      // فيُبعد المحرِّر عن هذه النسخة رغم اختيارها للتوّ مجدداً.
      if (versionSwitchingId && versionSwitchingId !== target.id) {
        ++versionRequestTokenRef.current;
        setVersionSwitchingId(null);
        setBusy(null);
        setNotice(null);
      }
      return;
    }
    if (dirty && !window.confirm(t("versionSwitchDiscardConfirm"))) return;
    void applyVersionSelection(target);
  }

  function reloadConflictedVersion() {
    if (!selectedVersion) return;
    // «تحديث النسخة» إعلانٌ صريح من التاجر بتجاهل حالته المحلية القديمة
    // (هذا هو سبب وجود الزر أصلاً بعد بانر التعارض) — `applyVersionSelection`
    // تلتقط تلك الحالة القديمة بالضبط بوصفها `draftAtSwitchStart`، فتُستبدَل
    // بأمان دون أي تجاوز خاص؛ حرسها الموحَّد يحمي فقط تعديلاً جديداً يقع
    // *بعد* هذا الضغط وأثناء انتظاره. لا نصفّر بانر التعارض هنا: نتركه لِـ
    // `applyVersionSelection` تصفيره فقط عند تبنّي المستند المجلوب فعلياً —
    // وإلا فشل هذا الجلب، أو نجاحه بعد تعديلٍ محلي جديد، يُسقط الحماية هنا
    // بالضبط في الحالة التي وُجدت لأجلها.
    void applyVersionSelection(selectedVersion);
  }

  function adoptCreatedVersion(detail: PresentationVersionDetail) {
    // إبطال أي طلب تبديل قيد التنفيذ — نسخة جديدة تم إنشاؤها للتو أولى بالتطبيق.
    ++versionRequestTokenRef.current;
    setVersionSwitchingId(null);
    // إبطال رمز الطلب يُسقط أي حفظ/تحميل قيد التنفيذ للنسخة السابقة من فحص
    // `stillCurrent` الخاص به، فلن يصفّر `busy` عند اكتماله لاحقاً — لولا هذا
    // السطر يبقى `busy === "saving"` عالقاً على النسخة الجديدة المفتوحة الآن
    // فيُعطَّل زرّ الحفظ حتى يبدّل التاجر النسخة ذهاباً وإياباً.
    setBusy(null);
    // أي تعارض معلَّق يخصّ النسخة *السابقة* حتماً — النسخة الجديدة المتبنّاة
    // هنا لم تُحفَظ قط فلا تعارض حقيقي لها. تركه قائماً يُبقي بانره ظاهراً
    // فوق هذه النسخة الجديدة (رسالته عامة، لا تسمّي نسخة بعينها)، وضغط زرّه
    // «تحديث النسخة» يُعيد تحميل هذه النسخة الجديدة نفسها *بلا* تأكيد تجاهل —
    // فيمحو بصمت أي تعديل محلي عليها ظنّاً من التاجر أنه يحلّ تعارضاً حقيقياً.
    setVersionConflict(null);
    setSelectedVersion(detail);
    setDraft(detail.config);
    setSaved(detail.config);
    setLifecycle("clean");
    setNotice(null);
    setSelectedSection(null);
    setSelectedChrome(null);
    updateVersionSummaryInList(detail);
  }

  // مسار الاختيار التلقائي الحاسم عند أول تحميل: يُستدعى من تأثير `storefrontId`
  // أدناه (`context: "mount"`، الافتراضي — عندها لا نسخة مفتوحة قطعاً، التأثير
  // صفّرها للتو)، **ومن زر «إعادة المحاولة»** بعد فشل القائمة أيضاً
  // (`context: "retry"`) — كان هذا الأخير يعيد تحميل الصفوف فقط دون إعادة
  // تشغيل منطق الاختيار (§13)، فمتجرٌ بمرشّح وحيد غير غامض كان يستقر على
  // `ready` بلا نسخة مفتوحة، ويبقى تنبيه الخطأ الأصلي ظاهراً رغم نجاح
  // المحاولة. لكن زرّ «إعادة المحاولة» داخل لوحة الإدارة نفسها يظهر أيضاً
  // بينما نسخة أخرى **مفتوحة فعلاً** (تحديث خلفي فشل، مثلاً بعد تعارض تسمية) —
  // تشغيل منطق الاختيار الأول عندها يستبدلها بصمت بلا تأكيد تجاهل. في سياق
  // `"retry"` فقط، لا نتابع إلى الاختيار إن كانت نسخة مفتوحة بالفعل؛ تحديث
  // صفوف القائمة وحده يكفي (يطابق سلوك الزر قبل الإصلاح، لحالة كهذه تحديداً).
  async function loadAndSelectInitialVersion(context: "mount" | "retry" = "mount") {
    if (!storefrontId) return;
    if (context === "retry" && selectedVersion) {
      void loadVersionList();
      return;
    }
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    setBusy("loading");
    setNoticeKind("status");
    setNotice(t("versionListLoading"));
    const list = await loadVersionList();
    if (!stillCurrent(originStorefrontId, tokenAtStart)) return;
    if (list === null) {
      setBusy(null);
      setNoticeKind("status");
      setNotice(t("versionListLoadError"));
      return;
    }
    setNotice(null);
    if (versionId) {
      // فتحٌ مباشر لنسخة محدَّدة صراحةً (`?version=` من معرض القوالب، مثلاً) —
      // يتجاوز منطق الاختيار التلقائي غير الغامض تماماً؛ تدفّقٌ آخر (لا
      // التاجر بالضرورة) قرَّر فعلياً أيّ نسخة يُفتَح، فلا داعي لإعادة تخمينها
      // من عدد المرشّحين في القائمة.
      await applyVersionSelection({ id: versionId });
      return;
    }
    // اختيار تلقائي غير غامض فقط: مرشّح وحيد غير منشور، أو نسخة منشورة
    // وحيدة بلا أي مسودة (§13 — لا نتخمّن بين عدة مسودات محتملة).
    const candidates = list.filter((v) => v.state !== "published");
    const target =
      candidates.length === 1
        ? candidates[0]
        : candidates.length === 0 && list.length === 1
          ? list[0]
          : null;
    if (!target) {
      setBusy(null);
      return;
    }
    await applyVersionSelection(target);
  }

  useEffect(() => {
    // يبطل أي طلب سابق (قائمة أو نسخة) قيد التنفيذ فوراً، ويُصفّر حالة النسخة
    // المرتبطة بالسياق السابق — وإلا، إن بدَّل المستدعي `storefrontId` دون
    // إعادة تركيب هذا المكوّن (تبديل المتجر النشط، أو حتى تفريغه إلى `null`)،
    // تبقى نسخة السياق القديم معروضة ومحدَّدة، وقد يُرسَل حفظ لاحق بمعرّفها
    // تحت مسار مختلف؛ كما قد تصل استجابة قائمة/نسخة متأخرة من السياق القديم
    // فتكتب فوق الحالة الجديدة. هذا يشمل التحوّل *إلى* `null` (لا مستأجر) لا
    // فقط بين مستأجرَين حقيقيَّين — التبديل العائد لاحقاً إلى مستأجر سيُعيد
    // تشغيل هذا التأثير من جديد فيصحّح نفسه، لكن حتى ذلك الحين يجب ألا يبقى
    // محرِّر «محلي بحت» يعرض بصمت نسخة مستأجر سابق.
    ++versionRequestTokenRef.current;
    setVersionSwitchingId(null);
    setSelectedVersion(null);
    setVersions([]);
    setVersionCreating(false);
    setVersionBusy(null);
    setVersionConflict(null);
    setSelectedSection(null);
    setSelectedChrome(null);
    setLifecycle("clean");
    // فتحٌ جديد (متجر مختلف، أو `versionId` صريح كمعرض القوالب) يبدأ من
    // الرئيسية دوماً — راجع "Theme Gallery Handoff". لا يمسّ هذا تبديل الصفحة
    // العادي أثناء الجلسة (`handleSelectPage`)، ولا تبديل النسخة العادي
    // (`applyVersionSelection`) اللذين يحافظان على الصفحة الحالية عمداً.
    setCurrentPage("home");
    // نفس منطق `currentPage` أعلاه بالضبط: فتحٌ جديد يبدأ بلا منتج معاينة
    // مُختار — الاختيار الفعلي (أول منتج مؤهَّل) يحدث في تأثير تحميل القائمة
    // أدناه، لا هنا. تبديل نسخة عادي أثناء الجلسة لا يمسّ هذا (راجع
    // "Version Switching" في العقد المعماري — الأهلية مرتبطة بقناة *المتجر*
    // لا بالنسخة، فتبقى صالحة عبر تبديل النسخ العادي تلقائياً).
    ++previewProductRequestRef.current;
    ++productListRequestRef.current;
    setPreviewProductId(null);
    setPreviewProduct(null);
    setPreviewProductState("idle");
    setProductList([]);
    setProductListState("idle");
    setProductSearch("");
    setSelectedProductRegion(null);

    if (!storefrontId) {
      setBusy(null);
      setNoticeKind("status");
      setNotice(null);
      setVersionsListState("ready");
      setDraft(clonePresentationConfig(seed));
      setSaved(clonePresentationConfig(seed));
      return;
    }

    setVersionsListState("loading");
    setDraft(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    setSaved(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));

    void loadAndSelectInitialVersion();
    // `versionId` مقصودةٌ في الاعتماديات: فتحٌ صريح لمعرّف نسخة (مثلاً
    // `?version=` من معرض القوالب) يجب أن يُعاد تشغيل هذا التأثير عند تغيّره
    // وحده، بمعزل عن تبديل `storefrontId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storefrontId, versionId]);

  // CUST-H2-3 — القائمة/التفصيل الفعليان المعروضان الآن: مستمَدّان من
  // `draft.pagePresentation.product.regions` إن وُجدت، وإلا من العقد
  // الافتراضي المحسوب محلياً (`defaultProductPageRegions()`) بلا كتابة إلى
  // `draft` — فتح صفحة المنتج وحده لا يُوسِّخ النسخة أبداً؛ التحرير الفعلي
  // (تبديل رؤية أو نقل) وحده يُماديها فعلياً عبر `updateDraft` أول مرة.
  const effectiveProductRegions: PageRegionInstance<ProductPageRegionKey>[] =
    draft.pagePresentation?.product?.regions ?? defaultProductPageRegions();

  async function loadProductList(search?: string) {
    if (!storefrontId) return;
    const token = ++productListRequestRef.current;
    const originStorefrontId = storefrontId;
    setProductListState("loading");
    const result = await listWorkspaceProducts(storefrontId, { search: search || undefined, perPage: 50 });
    if (token !== productListRequestRef.current || storefrontIdRef.current !== originStorefrontId) return;
    if (!result.ok) {
      setProductListState("error");
      setProductList([]);
      return;
    }
    setProductListState("ready");
    setProductList(result.data);
    if (result.data.length === 0) {
      setPreviewProductId(null);
      setPreviewProductState("empty");
      return;
    }
    // "Otherwise select the first eligible Product deterministically" —
    // only when there is no current selection yet, never overriding a
    // merchant's own (still-eligible) choice merely because the list
    // reloaded (e.g. after a search).
    setPreviewProductId((current) => current ?? result.data[0].id);
  }

  useEffect(() => {
    if (currentPage !== "product" || !storefrontId || productListState !== "idle") return;
    void loadProductList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, storefrontId, productListState]);

  useEffect(() => {
    if (!storefrontId || !previewProductId) return;
    const token = ++previewProductRequestRef.current;
    const originStorefrontId = storefrontId;
    const originProductId = previewProductId;
    setPreviewProductState("loading");
    void (async () => {
      const result = await showWorkspaceProduct(storefrontId, originProductId);
      if (token !== previewProductRequestRef.current || storefrontIdRef.current !== originStorefrontId) return;
      if (!result.ok) {
        if (result.reason === "not_found") {
          // Product deleted/unpublished between requests — never resurrect
          // a stale entity; fall back to a different eligible Product from
          // the already-loaded list, or an honest empty state if none remain.
          const fallback = productList.find((p) => p.id !== originProductId) ?? null;
          setPreviewProduct(null);
          if (fallback) {
            setPreviewProductId(fallback.id);
          } else {
            setPreviewProductId(null);
            setPreviewProductState("empty");
          }
          return;
        }
        setPreviewProduct(null);
        setPreviewProductState("error");
        return;
      }
      setPreviewProduct(result.data);
      setPreviewProductState("ready");
    })();
  }, [storefrontId, previewProductId, productList]);

  function handleSelectPreviewProduct(product: WorkspaceProductSummary) {
    if (product.id === previewProductId) return;
    setPreviewProductId(product.id);
  }

  function handleProductSearchChange(value: string) {
    setProductSearch(value);
    void loadProductList(value);
  }

  function handleRetryProductList() {
    void loadProductList(productSearch);
  }

  function handleSelectProductRegion(id: string) {
    setSelectedProductRegion(id);
    setPanel("product");
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSheet("settings");
    }
  }

  function writeProductRegions(regions: PageRegionInstance<ProductPageRegionKey>[]) {
    updateDraft({
      ...draft,
      pagePresentation: { ...draft.pagePresentation, product: { version: 1, regions } },
    });
  }

  function handleToggleProductRegionVisibility(id: string) {
    const regions = effectiveProductRegions.map((region) =>
      region.id === id ? { ...region, visible: !region.visible } : region,
    );
    writeProductRegions(regions);
  }

  function handleMoveProductRegion(id: string, delta: 1 | -1) {
    const index = effectiveProductRegions.findIndex((region) => region.id === id);
    if (index < 0) return;
    writeProductRegions(moveProductRegion(effectiveProductRegions, index, delta));
  }

  function updateDraft(next: StorefrontPresentationConfig) {
    if (isPublishedReadOnly) return; // فشل آمن دفاعي — لوحة التحكم مخفية أصلاً لهذه الحالة.
    const normalized = normalizePresentationConfig(next);
    // Keep the opaque SBC value lossless while the merchant is editing. The
    // persistence boundary below performs the contract-required outer trim.
    normalized.sbc.authentication_number = next.sbc.authentication_number;
    normalized.sbc.seal_token = next.sbc.seal_token;
    setDraft(normalized);
    setLifecycle("dirty");
    setNotice(null);
  }

  async function handleSave() {
    if (!storefrontId) {
      setLifecycle("save_blocked");
      setNoticeKind("capability");
      setNotice(t("noStoreSelected"));
      return;
    }
    if (!selectedVersion) {
      setLifecycle("save_blocked");
      setNoticeKind("capability");
      setNotice(t("versionNoVersionSelected"));
      return;
    }
    if (selectedVersion.state === "published") return; // زر الحفظ معطَّل لهذه الحالة أصلاً.
    if (versionConflict?.versionId === selectedVersion.id) return; // يجب تحديث النسخة أولاً — البانر يعرض زر ذلك.

    // لقطة الهوية وقت بدء الحفظ: إن بدَّل المستخدم النسخة المفتوحة أو المتجر
    // بينما طلب PUT هذا قيد التنفيذ، يجب ألا تُطبَّق نتيجته المتأخرة على
    // النسخة الجديدة المعروضة الآن — `applyVersionSelection`/`adoptCreatedVersion`
    // وتأثير تبديل المتجر تزيد هذا العدّاد ذاته عند كل تبديل، فتطابقه هنا كافٍ
    // لاكتشاف تبديل نسخة؛ `stillCurrent` يضيف فحص المتجر لتمييزه عن تبديل متجر
    // كامل (الذي يُفسد حتى تحديث صفّ القائمة، لا `draft`/`selectedVersion` فقط).
    const originStorefrontId = storefrontId;
    const savingVersionId = selectedVersion.id;
    const tokenAtSaveStart = versionRequestTokenRef.current;
    const draftAtSaveStart = draft;
    setBusy("saving");
    setNotice(null);
    setVersionConflict(null);
    const persistedDraft = normalizePresentationConfig(draft);
    const result = await savePresentationVersion(
      storefrontId,
      savingVersionId,
      persistedDraft,
      selectedVersion.revision,
    );
    const current = stillCurrent(originStorefrontId, tokenAtSaveStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    if (current) setBusy(null);
    if (result.ok) {
      // صفّ القائمة يبقى صالحاً للتحديث طالما المتجر نفسه، سواء أكانت هذه
      // النسخة مفتوحة الآن أم لا (تبديل نسخة داخل المتجر نفسه لا يُسقط ذلك) —
      // لكن `draft`/`saved`/`selectedVersion` ملك النسخة المفتوحة حالياً فقط.
      if (sameStorefront) updateVersionSummaryInList(result.data);
      if (!current) return;
      // التاجر قد يكون عدَّل المسودة مجدداً بعد إرسال الحفظ وقبل وصول هذه
      // الاستجابة — تلك التعديلات الأحدث ما زالت في `draftRef.current` ولا
      // تصل الخادم أصلاً بعد. استبدالها بلقطة الخادم (وهي مطابقة لِما أُرسل،
      // لا لِما يُعرَض الآن) يُفقدها بصمت. نحدِّث `saved`/`selectedVersion`
      // دوماً (مراجعة الخادم صحيحة الآن)، لكن `draft` فقط إن لم يتغيّر شيء.
      const editedSincePersist = !presentationConfigsEqual(draftRef.current, draftAtSaveStart);
      setSaved(result.data.config);
      setSelectedVersion(result.data);
      if (editedSincePersist) {
        setLifecycle("dirty");
      } else {
        setDraft(result.data.config);
        setLifecycle("clean");
      }
      setNoticeKind("status");
      setNotice(t("versionSaveSuccess"));
      return;
    }
    if (!current) return; // النسخة لم تعد مفتوحة (أو تبدّل المتجر) — لا تنبيه ولا تعارض يخصّ عرضاً حالياً مختلفاً.
    if (result.reason === "conflict") {
      setVersionConflict({ versionId: savingVersionId });
      return;
    }
    setNoticeKind("status");
    setNotice(t("versionSaveFailed"));
  }

  function handleRestore() {
    if (isPublishedReadOnly) return;
    const confirmed = window.confirm(t("restoreConfirm"));
    if (!confirmed) return;
    setDraft(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    setLifecycle("dirty");
    setNoticeKind("status");
    setNotice(null);
  }

  async function handleCreateVersion(name: string) {
    if (!storefrontId) return;
    // الإنشاء يتبنّى النسخة الجديدة فوراً في المحرِّر (`adoptCreatedVersion`)،
    // فيستبدل مسودة النسخة المفتوحة حالياً بصمت إن كانت غير محفوظة — نفس تأكيد
    // `selectVersion` قبل أي تبديل يُطبَّق هنا قبل حتى إرسال الطلب.
    if (dirty && !window.confirm(t("versionSwitchDiscardConfirm"))) return;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const draftAtStart = draft;
    const openVersionIdAtStart = selectedVersion?.id ?? null;
    const createRequestId = ++versionCreateRequestRef.current;
    setVersionCreating(true);
    const result = await createPresentationVersion(storefrontId, name);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // هوية طلب الإنشاء نفسه (`versionCreateRequestRef`)، لا الرمز العام: ذاك
    // يزيد أيضاً عند مجرَّد تبديل نسخة داخل المتجر نفسه — فلو استُعمل هنا
    // لبقي العلَم عالقاً `true` إلى الأبد كلما بدَّل التاجر النسخة المفتوحة أثناء
    // انتظار هذا الإنشاء بلا بدء إنشاء آخر. تبديل المتجر ذهاباً وإياباً
    // (A→B→A) يُصفِّر `versionCreating` (تأثير التركيب) ويزيد `versionCreateRequestRef`
    // عند أي إنشاء ثانٍ يبدأ لاحقاً لنفس المتجر A بينما الطلب الأول لا يزال
    // معلَّقاً؛ مطابقة المتجر وحدها كانت تُسكِت علَم الإنشاء عند اكتمال ذلك
    // الأول المتأخر رغم أن الثاني لا يزال قيد التنفيذ.
    const isLatestCreateRequest = createRequestId === versionCreateRequestRef.current;
    if (sameStorefront && isLatestCreateRequest) setVersionCreating(false);
    if (!result.ok) {
      if (sameStorefront && isLatestCreateRequest) {
        setNoticeKind("status");
        setNotice(t("versionCreateFailed"));
      }
      return;
    }
    if (!sameStorefront) return; // أُنشئت لمتجر لم يعد معروضاً إطلاقاً — موجودة على الخادم، تظهر عند العودة إليه.
    // تبديل نسخة (الرمز) أو تعديل جديد على المسودة المفتوحة (لا يُغيِّر الرمز)
    // وقع أثناء انتظار الإنشاء — كلاهما يعني أن ما يُعرَض الآن لم يعد يطابق ما
    // كان عليه حين بدأ الطلب، فلا يُفرَض تبنّي النسخة الجديدة عليه؛ صفّها في
    // القائمة يُحدَّث فقط، وتُفتَح لاحقاً صراحةً. هذا الفحص يستعمل الرمز العام
    // عمداً (لا هوية الإنشاء) — أي تبديل، لا إنشاءٌ ثانٍ فقط، يكفي لمنع التبنّي.
    // فحص الهوية الحيّة إضافةً: تبديلٌ قد يبدأ *قبل* هذا الإنشاء (فيزيد الرمز
    // العام مبكراً)، ويكتمل أثناء انتظاره — عندها `tokenAtStart` يطابق الرمز
    // الحالي من منظور هذا الطلب وحده رغم أن نسخة أخرى غير التي كانت مفتوحة
    // عند البدء أصبحت مفتوحة فعلاً؛ وإن تصادف أن محتواها مطابق لـ`draftAtStart`
    // (نسخ مستنسخة من بعضها، مثلاً) يفلت فحص المحتوى وحده أيضاً بصمت.
    if (
      tokenAtStart !== versionRequestTokenRef.current ||
      selectedVersionIdRef.current !== openVersionIdAtStart ||
      !presentationConfigsEqual(draftRef.current, draftAtStart)
    ) {
      updateVersionSummaryInList(result.data);
      return;
    }
    adoptCreatedVersion(result.data);
  }

  async function handleDuplicateVersion(version: PresentationVersionSummary, name: string) {
    if (!storefrontId) return;
    // نفس تأكيد الإنشاء أعلاه: التكرار يستنسخ آخر محتوى محفوظ من الخادم لا
    // المسودة المحلية، فتعديلات غير محفوظة على النسخة المفتوحة تُفقَد بصمت
    // (بلا حتى فرصة استرجاعها من النسخة الجديدة) إن لم نؤكّد قبل البدء.
    if (dirty && !window.confirm(t("versionSwitchDiscardConfirm"))) return;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const draftAtStart = draft;
    const openVersionIdAtStart = selectedVersion?.id ?? null;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: version.id, action: "duplicate" });
    const result = await createPresentationVersion(storefrontId, name, version.id);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // هوية طلب الكتابة نفسه (`versionWriteRequestRef`)، لا تطابق المتجر وحده:
    // `versionBusy` فتحة واحدة مشتركة بين التكرار/التسمية/الحذف، وتبديل
    // المتجر ذهاباً وإياباً (A→B→A) يُصفِّرها (تأثير التركيب) فيسمح ببدء كتابة
    // صفّ ثانية لنفس المتجر A بينما الأولى لا تزال معلَّقة؛ مطابقة المتجر وحدها
    // كانت تُفرِغ الفتحة عند اكتمال تلك الأولى المتأخرة رغم أن الثانية لا تزال
    // قيد التنفيذ فعلياً.
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (sameStorefront && isLatestWrite) {
        setNoticeKind("status");
        setNotice(t("versionDuplicateFailed"));
      }
      return;
    }
    if (!sameStorefront) return;
    // فحص الهوية الحيّة إضافةً — راجع تعليق `handleCreateVersion` أعلاه: تبديلٌ
    // بدأ *قبل* التكرار قد يكتمل أثناء انتظاره فيُفلِت من فحصَي الرمز والمحتوى
    // وحدهما إن تصادف أن محتوى النسخة المفتوحة الآن مطابقاً لـ`draftAtStart`.
    if (
      tokenAtStart !== versionRequestTokenRef.current ||
      selectedVersionIdRef.current !== openVersionIdAtStart ||
      !presentationConfigsEqual(draftRef.current, draftAtStart)
    ) {
      updateVersionSummaryInList(result.data);
      return;
    }
    adoptCreatedVersion(result.data);
  }

  async function handleRenameVersion(version: PresentationVersionSummary, name: string) {
    if (!storefrontId) return;
    if (versionConflict?.versionId === version.id) return; // يجب تحديث النسخة أولاً — راجع تعليق بانر التعارض.
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === version.id;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: version.id, action: "rename" });
    const result = await renamePresentationVersion(storefrontId, version.id, name, version.revision);
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // نفس حرص التكرار أعلاه: هوية طلب الكتابة، لا تطابق المتجر وحده — وإلا
    // فقد يُسكِت اكتمالٌ متأخر لهذا الطلب (بعد A→B→A) علَم كتابة صفّ ثانية
    // بدأت لاحقاً لنفس المتجر ولا تزال قيد التنفيذ.
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (result.reason === "conflict") {
        if (sameStorefront) {
          await loadVersionList();
          // المتجر أو النسخة قد يتبدّلان أثناء انتظار تحديث القائمة أعلاه —
          // `current`/`sameStorefront` أعلاه قِيمتان قِيسَتا *قبل* هذا الانتظار
          // الثاني، فإعادة استعمالهما هنا قد تُثبِت بانر التعارض على متجرٍ لم
          // يعد معروضاً أصلاً. أعِد الفحص من المراجع الحيّة بعد الاكتمال.
          if (storefrontIdRef.current !== originStorefrontId) return;
          if (stillCurrent(originStorefrontId, tokenAtStart) && wasOpenAtStart) {
            // النسخة المُعاد تسميتها هي نفسها المفتوحة محلياً الآن (ولم يتبدّل
            // شيء منذ بدء الطلب): تحديث صفّها في القائمة وحده غير كافٍ — محتوى
            // المحرِّر (draft) ومراجعته المحلية ما زالا قديمين، وقد تنجح إعادة
            // محاولة لاحقة (تسمية أو حفظ) بمراجعة الصفّ المحدَّث فتكتب فوق
            // تعديل جلسة أخرى بصمت. نفس بانر تعارض الحفظ إذن: لا إعادة تحميل
            // تلقائية، ولا حفظ ولا تسمية أخرى قبل أن يطلب المستخدم «تحديث
            // النسخة» صراحةً فتُعاد قراءة المستند كاملاً.
            setVersionConflict({ versionId: version.id });
          } else {
            setNoticeKind("status");
            setNotice(t("versionStaleConflict"));
          }
        }
        return;
      }
      if (current) {
        setNoticeKind("status");
        setNotice(t("versionRenameFailed"));
      }
      return;
    }
    // صفّ القائمة يبقى صالحاً للتحديث طالما المتجر نفسه؛ `selectedVersion` ملك
    // النسخة التي كانت مفتوحة عند البدء ولا تزال (`current && wasOpenAtStart`) —
    // إغلاق هذا الاستدعاء قد يرى `selectedVersion` نسخة أخرى فُتحت أثناء الانتظار.
    // `current` وحدها لا تكفي: تبديلٌ إلى نسخة أخرى قد يبدأ *قبل* هذا الطلب
    // (فيزيد الرمز العام مبكراً) ويكتمل أثناء انتظاره — عندها `tokenAtStart`
    // المُلتقَط هنا يطابق الرمز الحالي رغم أن نسخة مختلفة تماماً أصبحت مفتوحة
    // فعلياً؛ الفحص الحيّ على `selectedVersionIdRef` يكشف هذه الحالة تحديداً.
    if (sameStorefront) updateVersionSummaryInList(result.data);
    if (current && wasOpenAtStart && selectedVersionIdRef.current === version.id) {
      setSelectedVersion(result.data);
    }
  }

  async function handleDeleteVersion(version: PresentationVersionSummary) {
    if (!storefrontId) return;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === version.id;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: version.id, action: "delete" });
    const result = await deletePresentationVersion(storefrontId, version.id);
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // نفس حرص التكرار/التسمية أعلاه: هوية طلب الكتابة، لا تطابق المتجر وحده.
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (result.reason === "lifecycle_conflict") {
        if (sameStorefront) {
          await loadVersionList();
          // نفس تصحيح تعارض التسمية: المتجر قد يتبدّل أثناء انتظار هذا
          // التحديث الثاني — `sameStorefront` أعلاه قِيست *قبله*، فإعادة
          // استعمالها هنا قد تُثبِت تنبيه حذفٍ يخصّ متجراً سابقاً على متجرٍ
          // آخر تماماً فتحه المستخدم أثناء الانتظار.
          if (storefrontIdRef.current !== originStorefrontId) return;
          setNoticeKind("status");
          setNotice(t("versionLifecycleConflict"));
        }
        return;
      }
      if (sameStorefront && isLatestWrite) {
        setNoticeKind("status");
        setNotice(t("versionDeleteFailed"));
      }
      return;
    }
    if (sameStorefront) {
      setVersions((prev) => prev.filter((v) => v.id !== version.id));
    }
    if (current && wasOpenAtStart) {
      // لا يفترض أن يحدث (الواجهة تخفي حذف النسخة المفتوحة حالياً)، لكن
      // التعافي الآمن أولى من الاستمرار في تحرير نسخة لم تعد موجودة.
      setSelectedVersion(null);
      setDraft(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
      setSaved(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
      setLifecycle("clean");
    }
  }

  // CUST-H1-3 — يفتح حوار تأكيد النشر (لا يطلب الشبكة هنا مطلقاً). يُستدعى
  // من زرّ النشر في الشريط العلوي (النسخة المفتوحة حالياً) أو من إجراء «نشر
  // الآن» على صفّ في إدارة النسخ (قد لا تكون تلك النسخة مفتوحة في المحرِّر).
  function handleOpenPublishConfirm(version: PresentationVersionSummary) {
    setPublishTarget(version);
  }

  function handleCancelPublishConfirm() {
    if (versionBusy?.action === "publish") return; // طلب النشر قيد التنفيذ فعلياً — لا يُغلَق الحوار في منتصف الطريق.
    setPublishTarget(null);
  }

  async function handleConfirmPublish() {
    if (!storefrontId || !publishTarget) return;
    const target = publishTarget;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === target.id;
    // حالة رأس النشر التي "راجعها" التاجر فعلياً: آخر قائمة نُسخٍ حُمِّلت
    // بنجاح لهذا المتجر — لا قيمة مُخمَّنة أو مُعاد اشتقاقها هنا. `publishedRevision`
    // نفس القيمة على كل صفوف `versions` (حالة رأس واحدة للمتجر كله)، والنسخة
    // النشِطة هي الصفّ الوحيد بحالة `published` إن وُجد.
    const activeVersion = versions.find((v) => v.state === "published") ?? null;
    const expectedActiveVersionId = activeVersion?.id ?? null;
    const expectedPublishedRevision = target.publishedRevision;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: target.id, action: "publish" });
    const result = await publishPresentationVersion(
      storefrontId,
      target.id,
      target.revision,
      expectedPublishedRevision,
      expectedActiveVersionId,
    );
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // نفس حرص التكرار/التسمية/الحذف أعلاه: هوية طلب الكتابة، لا تطابق المتجر وحده.
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (!sameStorefront) return;
      setPublishTarget(null);
      // نحدِّث القائمة بعد أي فشل نشر — لا لإعادة محاولة النشر تلقائياً (ممنوع
      // صراحةً)، بل لتصحيح أي حالة رأس نشر محلية قديمة (`published_revision`/
      // النسخة المنشورة الحالية) قبل أن يعيد التاجر المحاولة يدوياً، كما
      // تشترط معمارية النشر (§CONCURRENCY).
      await loadVersionList();
      if (storefrontIdRef.current !== originStorefrontId || !isLatestWrite) return;
      setNoticeKind("status");
      setNotice(
        result.reason === "scheduled_conflict"
          ? t("versionPublishScheduledConflict")
          : result.reason === "unsupported_schema"
            ? t("versionPublishUnsupportedSchema")
            : result.reason === "forbidden"
              ? t("versionPublishForbidden")
              : result.reason === "not_found"
                ? t("versionPublishNotFound")
                : result.reason === "stale"
                  ? t("versionPublishStaleConflict")
                  : t("versionPublishFailed"),
      );
      return;
    }
    if (!sameStorefront) return;
    setPublishTarget(null);
    // نُحدِّث القائمة كاملةً، لا صفّ الهدف وحده: نشرٌ ناجح قد يُنزِل نسخة
    // أخرى (المنشورة سابقاً) من حالة "منشورة" إلى "مسودة" بالاشتقاق — تحديثٌ
    // جزئي هنا كان سيُبقي ذلك الصفّ يعرض حالته القديمة حتى تحديثٍ لاحق منفصل.
    const refreshedList = await loadVersionList();
    if (storefrontIdRef.current !== originStorefrontId) return; // تبدَّل المتجر أثناء تحديث القائمة.
    if (current && wasOpenAtStart && selectedVersionIdRef.current === target.id) {
      // النسخة المنشورة للتوّ هي نفسها المفتوحة في المحرِّر الآن (ولم يتبدَّل
      // شيء منذ بدء الطلب) — تتحوَّل إلى منشورة/مقروءة فقط فوراً؛ `updateDraft`
      // نفسها تمنع أي تعديل إضافي بمجرَّد أن تصبح `selectedVersion.state`
      // "published" (فشل آمن دفاعي مستقل عن هذا الفرع).
      setSelectedVersion(result.data);
      setSaved(result.data.config);
      setDraft(result.data.config);
      setLifecycle("clean");
    } else if (refreshedList) {
      // النسخة المفتوحة حالياً (إن وُجدت) قد تكون هي *سابقاً* المنشورة التي
      // فقدت هذه الحالة للتوّ بفعل نشر نسخة أخرى — تحديث حالتها المشتقة فقط
      // (بلا لمس `draft`/`saved`، فلا تعديل محلي يُفقَد) يمنعها من الاستمرار
      // بالظهور "منشورة ومقروءة فقط" بصمت حتى يبدِّل التاجر النسخة ذهاباً وإياباً.
      const openId = selectedVersionIdRef.current;
      const fresh = openId ? refreshedList.find((v) => v.id === openId) : undefined;
      if (fresh) {
        setSelectedVersion((prev) =>
          prev && prev.id === fresh.id
            ? {
                ...prev,
                state: fresh.state,
                publishedRevision: fresh.publishedRevision,
                lastPublishedAt: fresh.lastPublishedAt,
                scheduledFor: fresh.scheduledFor,
                updatedAt: fresh.updatedAt,
              }
            : prev,
        );
      }
    }
    if (isLatestWrite) {
      setNoticeKind("status");
      setNotice(t("versionPublishSuccess"));
    }
  }

  // CUST-H1-5 — يفتح حوار الجدولة (لا يطلب الشبكة هنا مطلقاً، تماماً كنظيره
  // في النشر). `mode` مشتقٌّ من حالة الهدف نفسها وقت الفتح: نسخة مجدولة
  // بالفعل تفتح في وضع "إعادة جدولة"، وأي نسخة أخرى مؤهَّلة (مسودة) في وضع
  // "جدولة" جديدة — الخادم يعامل الحالتين كمعاملة واحدة على أي حال
  // (`scheduleForCurrentTenant`، راجع تقرير CUST-H1-4).
  function handleOpenScheduleDialog(version: PresentationVersionSummary) {
    setScheduleTarget({ version, mode: version.state === "scheduled" ? "reschedule" : "schedule" });
  }

  function handleCancelScheduleDialog() {
    if (versionBusy?.action === "schedule") return; // طلب الجدولة قيد التنفيذ فعلياً — لا يُغلَق الحوار في منتصف الطريق.
    setScheduleTarget(null);
  }

  async function handleConfirmSchedule(scheduledForIso: string) {
    if (!storefrontId || !scheduleTarget) return;
    const { version: target, mode } = scheduleTarget;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === target.id;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: target.id, action: "schedule" });
    const result = await schedulePresentationVersion(
      storefrontId,
      target.id,
      target.revision,
      scheduledForIso,
      target.scheduleToken,
    );
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (!sameStorefront) return;
      // يُغلَق الحوار هنا عمداً — تماماً كنظيرها في `handleConfirmPublish`،
      // لا تفريقاً عنها: إبقاؤه مفتوحاً كان يترك `scheduleTarget.revision`/
      // `scheduleToken` القديمين معلَّقين في الحوار، فيُعيد أي ضغط ثانٍ على
      // «جدولة» إرسال نفس القيم القديمة ويكرّر 409 نفسه في حلقة صامتة. إغلاقه
      // يفرض إعادة فتحٍ صريحة (من صفّ محدَّث بعد `loadVersionList` أدناه)
      // بدل تكرار محاولة محكوم عليها بالفشل.
      setScheduleTarget(null);
      // نُحدِّث القائمة بعد أي فشل — لا لإعادة محاولة تلقائية (ممنوعة صراحةً)،
      // بل لتصحيح أي رمز/مراجعة جدولة محلية قديمة قبل أن يعيد التاجر المحاولة
      // يدوياً، تماماً كنظيرها في `handleConfirmPublish`.
      await loadVersionList();
      if (storefrontIdRef.current !== originStorefrontId || !isLatestWrite) return;
      setNoticeKind("status");
      setNotice(
        result.reason === "stale_token"
          ? t("versionScheduleStaleToken")
          : result.reason === "active_conflict"
            ? t("versionScheduleActiveConflict")
            : result.reason === "forbidden"
              ? t("versionScheduleForbidden")
              : result.reason === "not_found"
                ? t("versionScheduleNotFound")
                : result.reason === "stale_revision"
                  ? t("versionScheduleStaleRevision")
                  : t("versionScheduleFailed"),
      );
      return;
    }
    if (!sameStorefront) return;
    setScheduleTarget(null);
    // نُحدِّث القائمة كاملةً لا صفّ الهدف وحده: جدولة ناجحة قد تُنزِل نسخة
    // أخرى (المجدولة سابقاً لهذا المتجر) من "مجدولة" إلى "مسودة" بالاشتقاق —
    // تماماً كنظيرها في `handleConfirmPublish` عند استبدال نسخة منشورة.
    const refreshedList = await loadVersionList();
    if (storefrontIdRef.current !== originStorefrontId) return;
    if (current && wasOpenAtStart && selectedVersionIdRef.current === target.id) {
      setSelectedVersion(result.data);
    } else if (refreshedList) {
      const openId = selectedVersionIdRef.current;
      const fresh = openId ? refreshedList.find((v) => v.id === openId) : undefined;
      if (fresh) {
        setSelectedVersion((prev) =>
          prev && prev.id === fresh.id
            ? {
                ...prev,
                state: fresh.state,
                scheduledFor: fresh.scheduledFor,
                scheduleToken: fresh.scheduleToken,
                updatedAt: fresh.updatedAt,
              }
            : prev,
        );
      }
    }
    if (isLatestWrite) {
      setNoticeKind("status");
      setNotice(mode === "reschedule" ? t("versionRescheduleSuccess") : t("versionScheduleSuccess"));
    }
  }

  // CUST-H1-5 — يفتح حوار تأكيد إلغاء الجدولة (إجراء دورة حياة منفصل عن
  // الحذف العام — راجع تعليق `CancelScheduleConfirmDialog`).
  function handleOpenCancelScheduleConfirm(version: PresentationVersionSummary) {
    setCancelScheduleTarget(version);
  }

  function handleCancelCancelScheduleConfirm() {
    if (versionBusy?.action === "cancel_schedule") return;
    setCancelScheduleTarget(null);
  }

  async function handleConfirmCancelSchedule() {
    if (!storefrontId || !cancelScheduleTarget) return;
    const target = cancelScheduleTarget;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === target.id;
    const writeRequestId = ++versionWriteRequestRef.current;
    setVersionBusy({ id: target.id, action: "cancel_schedule" });
    const result = await cancelPresentationVersionSchedule(storefrontId, target.id, target.scheduleToken);
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    const isLatestWrite = writeRequestId === versionWriteRequestRef.current;
    if (sameStorefront && isLatestWrite) setVersionBusy(null);
    if (!result.ok) {
      if (!sameStorefront) return;
      // نفس تعليل إغلاق حوار الجدولة عند الفشل: `cancelScheduleTarget.scheduleToken`
      // القديم يبقى معلَّقاً في الحوار إن تُرك مفتوحاً، فتُعيد محاولة ثانية نفس
      // الرمز البائت وتكرّر 409 نفسه. الإغلاق يفرض فتحاً صريحاً لاحقاً من صفّ
      // محدَّث بعد `loadVersionList` أدناه.
      setCancelScheduleTarget(null);
      await loadVersionList();
      if (storefrontIdRef.current !== originStorefrontId || !isLatestWrite) return;
      setNoticeKind("status");
      setNotice(
        result.reason === "stale_token"
          ? t("versionCancelScheduleStaleToken")
          : result.reason === "not_scheduled"
            ? t("versionCancelScheduleNotScheduled")
            : t("versionCancelScheduleFailed"),
      );
      return;
    }
    if (!sameStorefront) return;
    setCancelScheduleTarget(null);
    await loadVersionList();
    if (storefrontIdRef.current !== originStorefrontId) return;
    if (current && wasOpenAtStart && selectedVersionIdRef.current === target.id) {
      setSelectedVersion(result.data);
    }
    if (isLatestWrite) {
      setNoticeKind("status");
      setNotice(t("versionCancelScheduleSuccess"));
    }
  }

  // Section selection bridge (STORE-CUSTOMIZER-V2-1), upgraded to instance
  // identity in V2-2: selection is a homepage section *instance id* (CONTRACT-2),
  // never a section type — two instances of the same type stay independently
  // selectable. Sidebar selection opens the homepage panel and queues a
  // scroll-to-section; preview clicks only update the selection (the section
  // is already in view, so scrolling again would be a pointless jump).
  // `null` clears the selection (e.g. after deleting the selected instance).
  function handleSelectChrome(target: PreviewChromeTarget) {
    setSelectedChrome(target);
    setSelectedSection(null);
    setPanel(target);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSheet("settings");
    }
  }

  // CUST-H2-2 — تبديل الصفحة الحالية. لا شبكة، لا حفظ، لا تغيير في `dirty`/
  // `lifecycle`، ولا استبدال للمسودة داخل النسخة نفسها (كلها تبقى كما هي —
  // راجع "Page Switching" في العقد المعماري). يُصفَّر فقط ما يصبح غير صالح
  // لسياق الصفحة الجديدة: تحديد قسم/كروم الصفحة الرئيسية (لا معنى له خارجها)،
  // ولوحة التحكم إن كانت مفتوحة على "homepage" تحديداً.
  function handleSelectPage(page: PageType) {
    if (page === currentPage) return;
    setCurrentPage(page);
    setSelectedSection(null);
    setSelectedChrome(null);
    if (page !== "product") {
      // Product region selection resets safely on leaving the page (task's
      // own "Page Switching" rule) — the underlying draft edits themselves
      // are untouched, only this transient selection UI state.
      setSelectedProductRegion(null);
    }
    if (page !== "home" && panel === "homepage") {
      setPanel("theme");
    }
    if (page !== "product" && panel === "product") {
      setPanel("theme");
    }
  }

  function handleSelectSection(
    id: string | null,
    origin: "sidebar" | "preview",
  ) {
    setSelectedSection(id);
    setSelectedChrome(null);
    if (id === null) return;
    // Both origins open the section's settings (Click-to-Edit foundation);
    // only sidebar selection needs the preview to scroll to the section,
    // since a preview click already has the section in view.
    setPanel("homepage");
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileSheet("settings");
    }
    if (origin === "sidebar") {
      setPendingSectionScroll(id);
    }
  }

  useEffect(() => {
    const id = pendingSectionScroll;
    if (!id) return;
    setPendingSectionScroll(null);
    if (typeof document === "undefined") return;
    const target = document.querySelector(`[data-preview-section-id="${id}"]`);
    if (!target || typeof target.scrollIntoView !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [pendingSectionScroll]);

  // Mobile viewports are canvas-first: the preview always runs in true mobile
  // device mode (390), never the desktop 1280 canvas — the device switcher is
  // a desktop/tablet-only control.
  const effectiveDevice: PreviewDevice = isMobileViewport ? "mobile" : device;
  const width = PREVIEW_WIDTHS[effectiveDevice];
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const inspectorScrollRef = useRef<HTMLDivElement | null>(null);
  const statusLabel =
    lifecycle === "save_blocked"
      ? t("save")
      : lifecycle === "publish_blocked"
        ? t("publish")
        : dirty
          ? t("dirty")
          : t("clean");

  // "Open store" renders only for a URL we can actually resolve to http(s) —
  // never link out to a malformed or javascript: value.
  const resolvedStorefrontUrl = (() => {
    if (!storefrontUrl) return null;
    try {
      const url = new URL(storefrontUrl);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  })();

  const versionManagerPanelProps: VersionManagerPanelProps = {
    locale,
    listState: versionsListState,
    versions,
    selectedVersionId: selectedVersion?.id ?? null,
    switchingVersionId: versionSwitchingId,
    // `versionCreating`/`versionBusy` علَما انشغال منفصلان (هويتا طلبٍ
    // مستقلَّتان منذ إصلاح السباق A→B→A) — لكنهما يتشاركان نفس المخاطر إن بدأ
    // أحدهما بينما الآخر معلَّق: إنشاءٌ من النموذج المضمَّن هنا أثناء تكرارٍ/
    // تسميةٍ/حذفٍ قيد التنفيذ على صفّ آخر ليس خطأً تقنياً (لكل منهما هويته
    // الآن) لكنه إرباكٌ تشغيلي غير مقصود لا داعي للسماح به.
    creating: versionCreating || versionBusy !== null,
    busyVersionId: versionBusy?.id ?? null,
    busyAction: versionBusy?.action ?? null,
    onRetryList: () => {
      void loadAndSelectInitialVersion("retry");
    },
    onSelect: (version) => selectVersion(version),
    onCreate: (name) => {
      void handleCreateVersion(name);
    },
    onDuplicate: (version, name) => {
      void handleDuplicateVersion(version, name);
    },
    onRename: (version, name) => {
      void handleRenameVersion(version, name);
    },
    onDelete: (version) => {
      void handleDeleteVersion(version);
    },
    onPublish: (version) => handleOpenPublishConfirm(version),
    onSchedule: (version) => handleOpenScheduleDialog(version),
    onReschedule: (version) => handleOpenScheduleDialog(version),
    onCancelSchedule: (version) => handleOpenCancelScheduleConfirm(version),
  };

  function renderInspectorBody(panelForSlot: CustomizerPanel) {
    // دفاعي: `visibleNavGroups`/`visiblePanels` تخفي "homepage" عن التنقّل
    // فعلياً خارج الرئيسية، و`handleSelectPage` تُعيد `panel` بعيداً عنه عند
    // التبديل — هذا يحمي فقط استدعاءً مباشراً متبقياً (ورقة الجوال "sections"
    // مقفلة على "homepage" حرفياً) لو انفتحت خارج الرئيسية بأي مسار لاحق.
    if (panelForSlot === "homepage" && currentPage !== "home") {
      return (
        <InspectorStatusMessage>
          {t("pagePlaceholderSidebarBody")}
        </InspectorStatusMessage>
      );
    }
    // CUST-H2-3 — بنية صفحة المنتج تُعرَض دوماً على صفحة المنتج، **حتى على
    // نسخة منشورة**: التاجر قد يتصفّح البنية ويختار منتج معاينة على المنشورة
    // (العقد المعماري، "Published Version" — "Merchant may: navigate Product
    // page; choose preview Product; inspect layout")، فهذا الفرع يسبق تحقّق
    // `isPublishedReadOnly` أدناه عمداً، بخلاف كل لوحة أخرى. `readOnly` يعطّل
    // فعلياً التبديل/النقل فقط — القائمة نفسها تبقى مرئية دوماً.
    if (panelForSlot === "product" && currentPage === "product") {
      return (
        <ProductRegionInspector
          locale={locale}
          regions={effectiveProductRegions}
          hasVariants={(previewProduct?.variants?.length ?? 0) > 0}
          selectedRegionId={selectedProductRegion}
          onSelectRegion={handleSelectProductRegion}
          onToggleVisibility={handleToggleProductRegionVisibility}
          onMove={handleMoveProductRegion}
          readOnly={isPublishedReadOnly}
        />
      );
    }
    if (!storefrontId) {
      // لا مستأجر محدَّد بعد — تحرير محلي بحت عبر `initialConfig`، بلا نسخ
      // ولا حفظ. سلوك ما قبل CUST-H1-2 حرفياً.
      return (
        <ControlPanels
          panel={panelForSlot}
          config={draft}
          locale={locale}
          liveStoreName={liveStoreName}
          businessIdentity={businessIdentity}
          onChange={updateDraft}
          selectedSection={selectedSection}
          onSelectSection={(id) => handleSelectSection(id, "sidebar")}
        />
      );
    }
    if (isPublishedReadOnly && selectedVersion) {
      return (
        <PublishedReadOnlyNotice
          locale={locale}
          versionName={selectedVersion.name}
          busy={versionBusy !== null || versionCreating}
          onCreateDraft={() => {
            // الخادم يرفض `name` أطول من 120 حرفاً (`CreateStorefrontPresentationVersionRequest`)
            // — نسخة منشورة باسمٍ قريب من الحدّ تجعل الاسم المولَّد هنا (بادئة +
            // اسمها) يتجاوزه، وهذا الزر لا يعرض حقل اسمٍ يُصحَّح منه، فكل إعادة
            // محاولة كانت سترسل نفس القيمة غير الصالحة. نقصّ السلسلة كاملةً
            // (بادئة + اسم) عند 120 حرفاً بدل رفض الطلب أو تعطيل الزرّ.
            const prefix = locale === "ar" ? "مسودة من " : "Draft from ";
            const name = `${prefix}${selectedVersion.name}`.slice(0, 120);
            void handleDuplicateVersion(toSummary(selectedVersion), name);
          }}
        />
      );
    }
    if (ambiguousChoice) {
      return (
        <ChooseVersionPrompt
          locale={locale}
          onOpenMobileManager={isMobileViewport ? () => setMobileSheet("versions") : undefined}
        />
      );
    }
    if (noVersionsYet) {
      return (
        <EmptyVersionsPrompt
          locale={locale}
          creating={versionCreating}
          onCreate={handleCreateVersion}
        />
      );
    }
    if (versionsListState === "loading" && !selectedVersion) {
      return <InspectorStatusMessage>{t("versionListLoading")}</InspectorStatusMessage>;
    }
    if (versionsListState === "error" && !selectedVersion) {
      return (
        <InspectorStatusMessage tone="error" onRetry={() => void loadAndSelectInitialVersion("retry")} retryLabel={t("versionReloadLatest")}>
          {t("versionListLoadError")}
        </InspectorStatusMessage>
      );
    }
    if (versionSwitchingId && !selectedVersion) {
      return <InspectorStatusMessage>{t("versionDetailLoading")}</InspectorStatusMessage>;
    }
    if (!selectedVersion) {
      return <InspectorStatusMessage live={false}>{t("versionNoVersionBody")}</InspectorStatusMessage>;
    }
    return (
      <ControlPanels
        panel={panelForSlot}
        config={draft}
        locale={locale}
        liveStoreName={liveStoreName}
        businessIdentity={businessIdentity}
        onChange={updateDraft}
        selectedSection={selectedSection}
        onSelectSection={(id) => handleSelectSection(id, "sidebar")}
      />
    );
  }

  return (
    <div
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-experience-builder=""
      data-version-id={versionId ?? ""}
      data-lifecycle={lifecycle}
      data-selected-version-id={selectedVersion?.id ?? ""}
      data-selected-version-state={selectedVersion?.state ?? ""}
      data-selected-version-revision={selectedVersion?.revision ?? ""}
      data-panel={panel}
      data-device={effectiveDevice}
      data-selected-section={selectedSection ?? ""}
      data-selected-chrome={selectedChrome ?? ""}
      data-current-page={currentPage}
      data-builder-navigation-collapsed={builderSidebarCollapsed ? "true" : "false"}
      className="relative flex h-full min-h-0 flex-col bg-background text-text"
    >
      <header className="z-20 flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 shadow-sm md:gap-3 md:px-5">
        <button
          type="button"
          aria-label={t("exit")}
          onClick={() => { window.location.href = "/commerce"; }}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:px-3 md:text-sm"
        >
          <span aria-hidden="true">←</span>
          <span className="hidden sm:inline">{t("exit")}</span>
        </button>
        <div className="min-w-0 border-s border-border ps-3">
          <p className="truncate text-[13px] font-semibold leading-none md:text-sm">
            {t("title")}
          </p>
          <div className="mt-1 hidden items-center gap-1 md:flex">
            <PageNavigator
              locale={locale}
              currentPage={currentPage}
              onSelect={handleSelectPage}
            />
            {currentPage === "product" && storefrontId ? (
              <ProductPreviewPicker
                locale={locale}
                selectedProduct={
                  previewProduct
                    ? {
                        id: previewProduct.id,
                        name: previewProduct.name,
                        nameEn: previewProduct.nameEn,
                        thumbnailUrl: previewProduct.media[0]?.url ?? null,
                        isVariantManaged: previewProduct.isVariantManaged,
                      }
                    : (productList.find((p) => p.id === previewProductId) ?? null)
                }
                listState={productListState === "idle" ? "loading" : productListState}
                products={productList}
                search={productSearch}
                onSearchChange={handleProductSearchChange}
                onSelect={handleSelectPreviewProduct}
                onRetry={handleRetryProductList}
                onOpenChange={(open) => {
                  if (open && productListState === "idle") void loadProductList();
                }}
              />
            ) : null}
          </div>
        </div>
        {storefrontId ? (
          isMobileViewport ? (
            <button
              type="button"
              data-version-selector-mobile=""
              onClick={() => setMobileSheet("versions")}
              className="flex min-w-0 items-center gap-1 border-s border-border px-2 py-1 ps-3 text-[11px] font-medium text-text"
            >
              <bdi className="max-w-[92px] truncate">
                {selectedVersion?.name ?? t("versionsLabel")}
              </bdi>
            </button>
          ) : (
            <VersionSelector
              locale={locale}
              currentName={selectedVersion?.name ?? null}
              currentState={selectedVersion?.state ?? null}
              loading={versionSwitchingId !== null}
              panelProps={versionManagerPanelProps}
            />
          )
        ) : null}
        <span
          data-draft-status=""
          className={`hidden shrink-0 rounded-full px-2 py-1 text-[11px] sm:inline ${dirty ? "bg-warning-soft text-warning" : "bg-positive-soft text-positive"}`}
        >
          {statusLabel}
        </span>
        <div className="ms-auto flex min-w-0 items-center gap-1.5 md:gap-2">
          {resolvedStorefrontUrl ? (
            <a
              data-open-store=""
              href={resolvedStorefrontUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:px-2.5"
            >
              {t("openStore")}
            </a>
          ) : null}
          <div className="hidden items-center gap-1 rounded-md border border-border p-1 md:flex">
            {(["desktop", "tablet", "mobile"] as const).map((item) => (
              <button
                key={item}
                type="button"
                data-device-option={item}
                aria-pressed={device === item}
                onClick={() => setDevice(item)}
                className={`h-8 rounded px-2.5 text-xs font-medium ${device === item ? "bg-primary text-primary-foreground" : "text-muted hover:bg-primary-soft hover:text-primary"}`}
              >
                {t(item)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRestore}
            disabled={isPublishedReadOnly}
            className="hidden h-9 shrink-0 px-2 text-xs text-muted hover:text-text disabled:opacity-40 lg:inline"
          >
            {t("restore")}
          </button>
          <button
            type="button"
            data-save=""
            onClick={handleSave}
            disabled={
              busy !== null ||
              !selectedVersion ||
              isPublishedReadOnly ||
              versionConflict?.versionId === selectedVersion?.id
            }
            title={
              isPublishedReadOnly
                ? t("versionPublishedReadOnlyTitle")
                : !storefrontId
                  ? t("noStoreSelected")
                  : !selectedVersion
                    ? t("versionNoVersionSelected")
                    : versionConflict?.versionId === selectedVersion?.id
                      ? t("versionStaleConflict")
                      : undefined
            }
            className="h-9 shrink-0 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 md:px-3 md:text-sm"
          >
            {t("save")}
          </button>
          <button
            type="button"
            data-publish=""
            onClick={() => {
              if (!selectedVersion) return;
              handleOpenPublishConfirm(toSummary(selectedVersion));
            }}
            disabled={
              !storefrontId ||
              !selectedVersion ||
              selectedVersion.state !== "draft" ||
              dirty ||
              versionConflict?.versionId === selectedVersion?.id ||
              busy !== null ||
              versionBusy !== null ||
              versionCreating
            }
            title={
              !storefrontId
                ? t("noStoreSelected")
                : !selectedVersion
                  ? t("versionNoVersionSelected")
                  : selectedVersion.state === "published"
                    ? t("versionPublishGatedPublished")
                    : selectedVersion.state === "scheduled"
                      ? t("versionPublishGatedScheduled")
                      : versionConflict?.versionId === selectedVersion?.id
                        ? t("versionStaleConflict")
                        : dirty
                          ? t("versionPublishSaveFirst")
                          : undefined
            }
            className="h-9 shrink-0 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-sm disabled:opacity-40 md:px-3 md:text-sm"
          >
            {t("publish")}
          </button>
          <button
            type="button"
            data-schedule=""
            // نفس أهلية النشر الفوري تماماً، بشرطٍ إضافي واحد: بوابة تشغيل
            // الإنتاج (`schedulingRuntimeActive`) — Schedule وPublish إجراءان
            // منفصلان ظاهرياً دوماً (لا إخفاء الجدولة لمجرَّد وجود نشر فوري)،
            // لكن كلاهما يحتاج مسودة محفوظة غير متعارضة أصلاً.
            onClick={() => {
              if (!selectedVersion) return;
              handleOpenScheduleDialog(toSummary(selectedVersion));
            }}
            disabled={
              !storefrontId ||
              !selectedVersion ||
              selectedVersion.state !== "draft" ||
              dirty ||
              versionConflict?.versionId === selectedVersion?.id ||
              busy !== null ||
              versionBusy !== null ||
              versionCreating ||
              !selectedVersion.schedulingRuntimeActive
            }
            title={
              !storefrontId
                ? t("noStoreSelected")
                : !selectedVersion
                  ? t("versionNoVersionSelected")
                  : selectedVersion.state === "published"
                    ? t("versionPublishGatedPublished")
                    : selectedVersion.state === "scheduled"
                      ? t("versionScheduleGatedScheduled")
                      : versionConflict?.versionId === selectedVersion?.id
                        ? t("versionStaleConflict")
                        : dirty
                          ? t("versionPublishSaveFirst")
                          : !selectedVersion.schedulingRuntimeActive
                            ? t("versionSchedulingGatedBody")
                            : undefined
            }
            // الشريط العلوي عند 768px مكتظّ بالفعل (منتقي النسخة + مبدِّل
            // الجهاز + حفظ + نشر) — عنصرٌ رابع دائم الظهور هنا يُفيض أفقياً
            // (مُتحقَّقٌ فعلياً: Playwright كشف الفيضان عند 768 و390px). نفس
            // معالجة زرّ «استعادة الافتراضي» (`hidden ... lg:inline`) بالضبط:
            // مخفيٌّ حتى سطح المكتب (lg+)، ومتاحٌ دوماً من إدارة النسخ على أي
            // مقاس — لا فقدان قدرة، فقط نقل «إجراء أقل تواتراً» عن الشريط
            // الضيّق تماشياً مع مرجع الأفق (§Toolbar: "Do not overload").
            className="hidden h-9 shrink-0 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text hover:bg-primary-soft disabled:opacity-40 lg:inline lg:px-3 lg:text-sm"
          >
            {t("versionSchedule")}
          </button>
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          data-capability-notice={noticeKind === "capability" ? "" : undefined}
          data-status-notice={noticeKind === "status" ? "" : undefined}
          className="shrink-0 border-b border-neutral-200 bg-white px-3 py-2 text-xs leading-5 text-neutral-700"
        >
          {noticeKind === "capability" ? (
            <span className="font-medium">{t("capabilityTitle")}. </span>
          ) : null}
          {notice}
        </div>
      ) : null}

      {versionConflict ? (
        <div
          role="alert"
          data-version-conflict=""
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning"
        >
          <span>{t("versionStaleConflict")}</span>
          <button
            type="button"
            data-version-reload=""
            onClick={reloadConflictedVersion}
            className="shrink-0 rounded-md border border-warning/40 bg-surface px-2.5 py-1 text-[11px] font-medium text-warning hover:bg-warning-soft"
          >
            {t("versionReloadLatest")}
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("controls")}
          data-customizer-scroll=""
          className={`${
            mobilePane === "preview" ? "hidden lg:flex" : "hidden md:flex"
          } ${builderSidebarCollapsed ? "lg:w-16" : "w-[196px]"} shrink-0 flex-col overflow-y-auto border-e border-neutral-200 bg-white`}
        >
          <div className={`flex h-12 shrink-0 items-center border-b border-neutral-200 px-2 ${builderSidebarCollapsed ? "justify-center" : "justify-end"}`}>
            <button
              type="button"
              aria-label={t(
                builderSidebarCollapsed
                  ? "expandBuilderNavigation"
                  : "collapseBuilderNavigation",
              )}
              aria-expanded={!builderSidebarCollapsed}
              title={t(
                builderSidebarCollapsed
                  ? "expandBuilderNavigation"
                  : "collapseBuilderNavigation",
              )}
              onClick={() => setBuilderSidebarCollapsed((collapsed) => !collapsed)}
              className="inline-flex size-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <SidebarToggleIcon locale={locale} collapsed={builderSidebarCollapsed} />
            </button>
          </div>
          <div className="flex flex-col py-2">
            {visibleNavGroups.map((group, groupIndex) => (
              <div
                key={group.items.map((item) => item.id).join("-")}
                className={
                  groupIndex > 0
                    ? "mt-2 border-t border-neutral-200 pt-2"
                    : undefined
                }
              >
                {group.items.map((item) => {
                  const selected = panel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-panel-option={item.id}
                      title={t(item.label)}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => setPanel(item.id)}
                      className={`flex h-9 w-full items-center text-start text-[13px] ${
                        builderSidebarCollapsed
                          ? "justify-center px-0"
                          : "gap-2.5 px-3"
                      } ${
                        selected
                          ? "bg-primary-soft font-medium text-primary"
                          : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                      }`}
                    >
                      <NavIcon panel={item.id} />
                      <span className={builderSidebarCollapsed ? "sr-only" : "min-w-0 truncate"}>
                        {t(item.label)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <aside
          data-builder-controls=""
          className={`${
            mobilePane === "edit" ? "flex" : "hidden"
          } w-full min-w-0 flex-col border-neutral-200 bg-white md:flex-1 lg:flex lg:w-[300px] lg:flex-none lg:border-e xl:w-[320px]`}
        >
          <div className="shrink-0 border-b border-neutral-200 px-3 py-2 md:hidden">
            <label className="sr-only" htmlFor="customizer-panel-select">
              {t("controls")}
            </label>
            <select
              id="customizer-panel-select"
              value={panel}
              onChange={(event) =>
                setPanel(event.target.value as CustomizerPanel)
              }
              className="h-11 w-full border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-800"
            >
              {visiblePanels.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden shrink-0 border-b border-neutral-200 px-4 py-3 md:block">
            <h2 className="text-[15px] font-semibold leading-tight">
              {activePanel ? t(activePanel.label) : t("theme")}
            </h2>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              ref={inspectorScrollRef}
              data-customizer-scroll=""
              className="h-full min-h-0 overflow-y-auto px-4 py-4 md:px-5 md:py-5 lg:px-4 lg:py-5"
            >
              {renderInspectorBody(panel)}
            </div>
            <ScrollIndicator targetRef={inspectorScrollRef} />
          </div>
        </aside>

        <section
          data-builder-preview=""
          aria-label={t("livePreview")}
          className={`${
            mobilePane === "preview" ? "flex" : "hidden"
          } min-w-0 flex-1 flex-col lg:flex`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-3 text-[11px] text-neutral-500">
            <div className="flex min-w-0 items-center gap-2">
              {isMobileViewport ? (
                // الجوال لا يعرض `PageNavigator` الشريط العلوي (مخفيّ تحت
                // `md`) — حبّة مدمجة هنا تفتح ورقة "pages" السفلية بدل نص
                // "معاينة المتجر" الساكن، فلا يُستهلَك عرضٌ جديد بلا فائدة
                // مقابلة على هذا الشريط الضيّق أصلاً.
                <button
                  type="button"
                  data-page-navigator-mobile=""
                  onClick={() => setMobileSheet("pages")}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 py-0.5 font-medium text-neutral-700"
                >
                  <PageIcon page={currentPage} />
                  <bdi className="max-w-[86px] truncate">{t(pageLabelKey(currentPage))}</bdi>
                </button>
              ) : (
                <span className="shrink-0 font-medium text-neutral-700">
                  {t("livePreview")}
                </span>
              )}
              {selectedVersion ? (
                <span data-version-preview-banner="" className="min-w-0 truncate">
                  <bdi className="font-medium text-neutral-700">{selectedVersion.name}</bdi>
                  {" · "}
                  {selectedVersion.state === "published"
                    ? t("versionStatePublished")
                    : selectedVersion.state === "scheduled"
                      ? t("versionStateScheduled")
                      : t("versionStateDraft")}
                  {selectedVersion.state === "published" ? (
                    <span className="text-positive"> — {t("versionPreviewBannerLive")}</span>
                  ) : (
                    <span className="text-warning"> — {t("versionPreviewBannerNonLive")}</span>
                  )}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums">
                {t("deviceWidth")} · {width}
              </span>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              ref={canvasScrollRef}
              data-customizer-scroll=""
              // CUST-H2-2 QA finding (pre-existing, not new here): `relative
              // z-0` gives this scroll region — which holds the Canvas's own
              // `position: sticky` header — an *explicit* stacking context.
              // Without one, real Chromium at exactly 768px paints that
              // sticky header above a `z-50` toolbar popover (Version
              // Manager or the new Page Navigator) regardless of z-index,
              // transform, or will-change on either side — confirmed with
              // the exact pinned Playwright Chromium build, reproducible on
              // unmodified `main` for `VersionSelector` alone (undiscovered
              // until this slice, since no prior test opened a toolbar
              // dropdown and clicked inside it at 768px). This one-line fix
              // (an explicit z-index on the containing scroll region, so the
              // browser compares the whole region against the popover by
              // normal stacking rules instead of an implicit/ambiguous one)
              // resolves it for both controls without touching the shared
              // `Dropdown` component or `StorefrontPreviewCanvas`.
              className="relative z-0 h-full min-h-0 overflow-y-auto overscroll-contain p-3 md:overflow-y-scroll md:p-5 xl:p-8"
            >
              <div
                data-preview-frame=""
                className="mx-auto overflow-hidden border border-neutral-300 bg-white"
                style={{ width: Math.min(width, 1440), maxWidth: "100%" }}
              >
                <StorefrontPreviewCanvas
                  config={draft}
                  locale={locale}
                  viewport={effectiveDevice}
                  page={currentPage}
                  liveStoreName={liveStoreName}
                  businessIdentity={businessIdentity}
                  selectedSection={selectedSection}
                  onSelectSection={(key) => handleSelectSection(key, "preview")}
                  selectedChrome={selectedChrome}
                  onSelectChrome={handleSelectChrome}
                  productPreviewState={previewProductState}
                  previewProduct={previewProduct}
                  productRegions={effectiveProductRegions}
                  selectedProductRegionId={selectedProductRegion}
                  onSelectProductRegion={handleSelectProductRegion}
                />
              </div>
            </div>
            <ScrollIndicator targetRef={canvasScrollRef} />
          </div>
        </section>
      </div>

      {isMobileViewport ? <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 lg:hidden">
        {currentPage === "home" ? (
          <>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => setMobileSheet("sections")}
            >
              {t("sections")}
            </button>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => setMobileSheet("sections")}
            >
              + {t("addSection")}
            </button>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => { setPanel("theme"); setMobileSheet("design"); }}
            >
              {t("design")}
            </button>
          </>
        ) : currentPage === "product" ? (
          // CUST-H2-3 — يعيد استعمال فتحات الأزرار الثلاثة نفسها (نفس مبدأ
          // إعادة استعمال منتقي الصفحة لفتحة الشريط الميتة): "معاينة منتج"
          // بدل "الأقسام"، "بنية الصفحة" بدل "+ إضافة قسم" (تُعيد استعمال
          // ورقة "sections" نفسها — راجع فرعها أدناه)، و"التصميم" كما هو.
          <>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => setMobileSheet("product-picker")}
            >
              {t("productPickerTriggerLabel")}
            </button>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => { setPanel("product"); setMobileSheet("sections"); }}
            >
              {t("productRegionsPanelLabel")}
            </button>
            <button
              type="button"
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => { setPanel("theme"); setMobileSheet("design"); }}
            >
              {t("design")}
            </button>
          </>
        ) : (
          // تصنيف: لا أقسام رئيسية تُحرَّر هنا بعد (CUST-H2-4) — "الأقسام"/
          // "+ إضافة قسم" تختصّان بمركّب الرئيسية حصراً؛ عرضهما هنا كان
          // يوحي بتحرير مناطق غير موجودة فعلياً. "التصميم" العالمي يبقى
          // صالحاً على كل صفحة فيبقى متاحاً وحده.
          <button
            type="button"
            className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => { setPanel("theme"); setMobileSheet("design"); }}
          >
            {t("design")}
          </button>
        )}
      </div> : null}

      {isMobileViewport && mobileSheet ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden"
          role="presentation"
          onClick={(event) => { if (event.target === event.currentTarget) setMobileSheet(null); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              mobileSheet === "sections"
                ? currentPage === "product"
                  ? t("productRegionsPanelLabel")
                  : t("sections")
                : mobileSheet === "design"
                  ? t("design")
                  : mobileSheet === "versions"
                    ? t("versionManagerTitle")
                    : mobileSheet === "pages"
                      ? t("pageNavigatorMenuTitle")
                      : mobileSheet === "product-picker"
                        ? t("productPickerMenuTitle")
                        : activePanel
                          ? t(activePanel.label)
                          : t("edit")
            }
            className="flex max-h-[86dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-text">
                {mobileSheet === "sections"
                  ? currentPage === "product"
                    ? t("productRegionsPanelLabel")
                    : t("sections")
                  : mobileSheet === "design"
                    ? t("design")
                    : mobileSheet === "versions"
                      ? t("versionManagerTitle")
                      : mobileSheet === "pages"
                        ? t("pageNavigatorMenuTitle")
                        : mobileSheet === "product-picker"
                          ? t("productPickerMenuTitle")
                          : activePanel
                            ? t(activePanel.label)
                            : t("edit")}
              </h2>
              <button
                type="button"
                aria-label={t("close")}
                onClick={() => setMobileSheet(null)}
                className="flex size-10 items-center justify-center rounded-md text-muted hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                ×
              </button>
            </div>
            <div data-customizer-scroll="" className="min-h-0 flex-1 overflow-y-auto p-4">
              {mobileSheet === "versions" ? (
                <VersionManagerPanel
                  {...versionManagerPanelProps}
                  onSelect={(version) => {
                    selectVersion(version);
                    setMobileSheet(null);
                  }}
                  onPublish={(version) => {
                    setMobileSheet(null);
                    handleOpenPublishConfirm(version);
                  }}
                  onSchedule={(version) => {
                    setMobileSheet(null);
                    handleOpenScheduleDialog(version);
                  }}
                  onReschedule={(version) => {
                    setMobileSheet(null);
                    handleOpenScheduleDialog(version);
                  }}
                  onCancelSchedule={(version) => {
                    setMobileSheet(null);
                    handleOpenCancelScheduleConfirm(version);
                  }}
                />
              ) : mobileSheet === "pages" ? (
                <PageNavigatorPanel
                  locale={locale}
                  currentPage={currentPage}
                  onSelect={(page) => {
                    handleSelectPage(page);
                    setMobileSheet(null);
                  }}
                />
              ) : mobileSheet === "product-picker" ? (
                <ProductPreviewPickerPanel
                  locale={locale}
                  listState={
                    productListState === "idle" ? "loading" : productListState
                  }
                  products={productList}
                  selectedProductId={previewProductId}
                  search={productSearch}
                  onSearchChange={handleProductSearchChange}
                  onSelect={(product) => {
                    handleSelectPreviewProduct(product);
                    setMobileSheet(null);
                  }}
                  onRetry={handleRetryProductList}
                />
              ) : mobileSheet === "sections" ? (
                renderInspectorBody(currentPage === "product" ? "product" : "homepage")
              ) : (
                renderInspectorBody(mobileSheet === "design" ? "theme" : panel)
              )}
            </div>
          </section>
        </div>
      ) : null}

      {publishTarget ? (
        <PublishConfirmDialog
          locale={locale}
          target={publishTarget}
          storeName={liveStoreName}
          hasExistingLive={versions.some((v) => v.state === "published" && v.id !== publishTarget.id)}
          busy={versionBusy?.id === publishTarget.id && versionBusy.action === "publish"}
          onCancel={handleCancelPublishConfirm}
          onConfirm={() => void handleConfirmPublish()}
        />
      ) : null}

      {scheduleTarget ? (
        <ScheduleConfirmDialog
          locale={locale}
          mode={scheduleTarget.mode}
          target={scheduleTarget.version}
          storeName={liveStoreName}
          timezone={tenantTimezone}
          replacingVersion={
            scheduleTarget.mode === "schedule"
              ? (versions.find((v) => v.state === "scheduled" && v.id !== scheduleTarget.version.id) ?? null)
              : null
          }
          busy={versionBusy?.id === scheduleTarget.version.id && versionBusy.action === "schedule"}
          onCancel={handleCancelScheduleDialog}
          onConfirm={(iso) => void handleConfirmSchedule(iso)}
        />
      ) : null}

      {cancelScheduleTarget ? (
        <CancelScheduleConfirmDialog
          locale={locale}
          target={cancelScheduleTarget}
          busy={versionBusy?.id === cancelScheduleTarget.id && versionBusy.action === "cancel_schedule"}
          onCancel={handleCancelCancelScheduleConfirm}
          onConfirm={() => void handleConfirmCancelSchedule()}
        />
      ) : null}

      <span className="sr-only">
        {DRAFT_PERSISTENCE_CAPABILITY}:{PUBLISH_CAPABILITY}
      </span>
    </div>
  );
}

function InspectorStatusMessage({
  children,
  tone = "muted",
  onRetry,
  retryLabel,
  live = true,
}: {
  children: ReactNode;
  tone?: "muted" | "error";
  onRetry?: () => void;
  retryLabel?: string;
  /** false for a static "nothing to show" fallback — avoids a second
   * simultaneous `role="status"` region colliding with the top notice bar's. */
  live?: boolean;
}) {
  return (
    <div
      role={live ? "status" : undefined}
      className={`flex flex-col items-start gap-2 px-1 py-6 text-sm ${tone === "error" ? "text-negative" : "text-muted"}`}
    >
      <p>{children}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:bg-primary-soft"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function EmptyVersionsPrompt({
  locale,
  creating,
  onCreate,
}: {
  locale: CustomizerLocale;
  creating: boolean;
  onCreate: (name: string) => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  const [name, setName] = useState("");
  return (
    <div data-version-empty-state="" className="flex flex-col items-start gap-3 px-1 py-6">
      <p className="text-sm font-medium text-text">{t("versionEmptyTitle")}</p>
      <p className="text-xs text-muted">{t("versionEmptyBody")}</p>
      <div className="flex w-full items-center gap-1.5">
        <label className="sr-only" htmlFor="version-empty-create-name">
          {t("versionNamePrompt")}
        </label>
        <input
          id="version-empty-create-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !creating && name.trim() !== "") onCreate(name.trim());
          }}
          placeholder={t("versionNamePlaceholder")}
          maxLength={120}
          className="h-9 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <button
        type="button"
        data-version-create-first=""
        disabled={creating || name.trim() === ""}
        onClick={() => onCreate(name.trim())}
        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {creating ? t("versionCreating") : t("versionCreateFirst")}
      </button>
    </div>
  );
}

function ChooseVersionPrompt({
  locale,
  onOpenMobileManager,
}: {
  locale: CustomizerLocale;
  onOpenMobileManager?: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <div data-version-choose-state="" className="flex flex-col items-start gap-2 px-1 py-6">
      <p className="text-sm font-medium text-text">{t("versionChooseTitle")}</p>
      <p className="text-xs text-muted">{t("versionChooseBody")}</p>
      {onOpenMobileManager ? (
        <button
          type="button"
          onClick={onOpenMobileManager}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          {t("versionOpenManager")}
        </button>
      ) : (
        <p className="text-xs text-muted">{t("versionOpenManagerHint")}</p>
      )}
    </div>
  );
}

function PublishedReadOnlyNotice({
  locale,
  versionName,
  busy,
  onCreateDraft,
}: {
  locale: CustomizerLocale;
  versionName: string;
  busy: boolean;
  onCreateDraft: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <div data-version-published-readonly="" className="flex flex-col items-start gap-2 px-1 py-6">
      <p className="text-sm font-medium text-text">{t("versionPublishedReadOnlyTitle")}</p>
      <p className="text-xs text-muted">{t("versionPublishedReadOnlyBody")}</p>
      <button
        type="button"
        data-version-create-draft-from-published=""
        disabled={busy}
        onClick={onCreateDraft}
        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? t("versionDuplicating") : t("versionCreateDraftFromThis")}
      </button>
      <p className="text-[11px] text-muted">
        <bdi>{versionName}</bdi>
      </p>
    </div>
  );
}

/**
 * CUST-H1-3 — حوار تأكيد النشر الفوري. عملٌ عالي الثقة: يذكر صراحةً اسم
 * النسخة، المتجر المتأثر، أن التصميم الحي الحالي سيُستبدَل، وأن النسخة
 * المنشورة الحالية ستبقى محتفَظاً بها كنسخة سابقة قابلة للاسترجاع — لا
 * "هل أنت متأكد؟" عامة (مرجع UX: docs/plans/store/CUST-H1-THEME-VERSIONS-EVIDENCE-UX.md §6.5).
 * مركزيٌّ لا Bottom Sheet — نفس الترميز على الجوال وسطح المكتب، بعرض أقصى
 * يبقيه مضغوطاً وواضحاً على 390px، وتمرير مستقل إن طال المحتوى.
 */
function PublishConfirmDialog({
  locale,
  target,
  storeName,
  hasExistingLive,
  busy,
  onCancel,
  onConfirm,
}: {
  locale: CustomizerLocale;
  target: PresentationVersionSummary;
  storeName: string | null;
  hasExistingLive: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-confirm-title"
        data-publish-confirm-dialog=""
        className="flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2xl"
      >
        <h2 id="publish-confirm-title" className="text-sm font-semibold text-text">
          {t("versionPublishConfirmTitlePrefix")}
          <bdi>{target.name}</bdi>
          {t("versionPublishConfirmTitleSuffix")}
        </h2>
        <p className="mt-2 text-xs text-muted">
          {t("versionPublishConfirmStorefrontLabel")}: <bdi>{storeName ?? t("currentPage")}</bdi>
        </p>
        <p className="mt-3 text-xs leading-5 text-text">
          {hasExistingLive ? t("versionPublishConfirmReplaceBody") : t("versionPublishConfirmFirstBody")}
        </p>
        {hasExistingLive ? (
          <p className="mt-2 text-xs leading-5 text-muted">{t("versionPublishConfirmRetainBody")}</p>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-publish-confirm-cancel=""
            disabled={busy}
            onClick={onCancel}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-text hover:bg-primary-soft disabled:opacity-50"
          >
            {t("versionPublishConfirmCancel")}
          </button>
          <button
            type="button"
            data-publish-confirm-submit=""
            disabled={busy}
            onClick={onConfirm}
            className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? t("versionPublishing") : t("versionPublishConfirmSubmit")}
          </button>
        </div>
      </section>
    </div>
  );
}

function NavIcon({ panel }: { panel: CustomizerPanel }) {
  const common = {
    viewBox: "0 0 16 16",
    className: "size-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true as const,
  };
  const icons: Record<CustomizerPanel, ReactNode> = {
    theme: (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.25" />
        <circle cx="11" cy="5.5" r="1.75" />
        <circle cx="9.5" cy="11" r="2" />
      </svg>
    ),
    branding: (
      <svg {...common}>
        <path d="M3 13V5.5L8 3l5 2.5V13" />
        <path d="M8 7.5v5.5" />
      </svg>
    ),
    header: (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="10" />
        <path d="M2.5 6.25h11" />
      </svg>
    ),
    homepage: (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="11" height="3" />
        <rect x="2.5" y="7" width="5" height="6.5" />
        <rect x="8.5" y="7" width="5" height="6.5" />
      </svg>
    ),
    product: (
      <svg {...common}>
        <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z" />
        <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
      </svg>
    ),
    footer: (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="10" />
        <path d="M2.5 9.75h11" />
      </svg>
    ),
    contact: (
      <svg {...common}>
        <path d="M3 4.5h10v7H3z" />
        <path d="M3 4.5 8 8.25 13 4.5" />
      </svg>
    ),
    whatsapp: (
      <svg {...common}>
        <path d="M4 12.5 3.25 14 5.5 13A5.5 5.5 0 1 0 4 12.5Z" />
      </svg>
    ),
    social: (
      <svg {...common}>
        <circle cx="5" cy="8" r="2" />
        <circle cx="11.5" cy="4.5" r="1.75" />
        <circle cx="11.5" cy="11.5" r="1.75" />
        <path d="M6.7 7.1 9.8 5.3M6.7 8.9 9.8 10.7" />
      </svg>
    ),
    verification: (
      <svg {...common}>
        <path d="M8 2.5 13 4.5v4.2c0 3.1-2.2 4.9-5 5.8-2.8-.9-5-2.7-5-5.8V4.5L8 2.5Z" />
      </svg>
    ),
    apps: (
      <svg {...common}>
        <rect x="4" y="2.5" width="8" height="11" />
        <path d="M6.5 12.5h3" />
      </svg>
    ),
    pages: (
      <svg {...common}>
        <path d="M4.5 2.5h5.2L12.5 5.3V13.5H4.5z" />
        <path d="M9.5 2.5V5.5H12.5" />
      </svg>
    ),
  };
  return icons[panel];
}

function SidebarToggleIcon({
  locale,
  collapsed,
}: {
  locale: CustomizerLocale;
  collapsed: boolean;
}) {
  const points =
    locale === "ar"
      ? collapsed
        ? "10 3 15 8 10 13"
        : "6 3 1 8 6 13"
      : collapsed
        ? "6 3 1 8 6 13"
        : "10 3 15 8 10 13";
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={points} />
    </svg>
  );
}
