"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ScrollIndicator } from "./ScrollIndicator";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  type HomeBuilderSectionKey,
  normalizePresentationConfig,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "./presentation";
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
import {
  VersionManagerPanel,
  type VersionManagerListState,
  type VersionManagerPanelProps,
} from "./VersionManagerPanel";
import {
  createPresentationVersion,
  deletePresentationVersion,
  listPresentationVersions,
  type PresentationVersionDetail,
  type PresentationVersionSummary,
  renamePresentationVersion,
  savePresentationVersion,
  showPresentationVersion,
} from "@/modules/commerce-workspace/presentation-versions";

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

type MobileSheet = "sections" | "settings" | "design" | "versions" | null;

interface ExperienceBuilderProps {
  initialConfig?: StorefrontPresentationConfig;
  liveStoreName?: string | null;
  businessIdentity?: StorefrontBusinessIdentity;
  initialLocale?: CustomizerLocale;
  storefrontId?: string | null;
  storefrontUrl?: string | null;
}

export function ExperienceBuilder({
  initialConfig,
  liveStoreName = null,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  initialLocale = "ar",
  storefrontId = null,
  storefrontUrl = null,
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
    { id: string; action: "duplicate" | "rename" | "delete" } | null
  >(null);
  const [versionConflict, setVersionConflict] = useState<{ versionId: string } | null>(null);
  const versionRequestTokenRef = useRef(0);
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

  function stillCurrent(originStorefrontId: string | null, tokenAtStart: number): boolean {
    return storefrontIdRef.current === originStorefrontId && tokenAtStart === versionRequestTokenRef.current;
  }

  const t = (key: CustomizerMessageKey) => customizerMessage(locale, key);

  const dirty = !presentationConfigsEqual(draft, saved);
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
    setVersionSwitchingId(target.id);
    setVersionConflict(null);
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
    setNotice(null);
    setSelectedVersion(result.data);
    setDraft(result.data.config);
    setSaved(result.data.config);
    setLifecycle("clean");
    setSelectedSection(null);
    setSelectedChrome(null);
    updateVersionSummaryInList(result.data);
  }

  function selectVersion(target: PresentationVersionSummary) {
    if (selectedVersion?.id === target.id) return;
    if (dirty && !window.confirm(t("versionSwitchDiscardConfirm"))) return;
    void applyVersionSelection(target);
  }

  function reloadConflictedVersion() {
    if (!selectedVersion) return;
    setVersionConflict(null);
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
  // أدناه، **ومن زر «إعادة المحاولة»** بعد فشل القائمة أيضاً — كان هذا الأخير
  // يعيد تحميل الصفوف فقط دون إعادة تشغيل منطق الاختيار (§13)، فمتجرٌ بمرشّح
  // وحيد غير غامض كان يستقر على `ready` بلا نسخة مفتوحة، ويبقى تنبيه الخطأ
  // الأصلي ظاهراً رغم نجاح المحاولة. مسارٌ واحد لكلا نقطتي الدخول يمنع الانحراف.
  async function loadAndSelectInitialVersion() {
    if (!storefrontId) return;
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
    if (!storefrontId) {
      setBusy(null);
      return;
    }

    // يبطل أي طلب سابق (قائمة أو نسخة) قيد التنفيذ فوراً، ويُصفّر حالة النسخة
    // المرتبطة بالمتجر السابق — وإلا، إن بدَّل المستدعي `storefrontId` دون
    // إعادة تركيب هذا المكوّن (تبديل المتجر النشط)، تبقى نسخة المتجر القديم
    // معروضة ومحدَّدة، وقد يُرسَل حفظ لاحق بمعرّفها تحت مسار المتجر الجديد؛
    // كما قد تصل استجابة قائمة/نسخة متأخرة من المتجر القديم فتكتب فوق حالة
    // المتجر الجديد.
    ++versionRequestTokenRef.current;
    setVersionSwitchingId(null);
    setSelectedVersion(null);
    setVersions([]);
    setVersionsListState("loading");
    setVersionCreating(false);
    setVersionBusy(null);
    setVersionConflict(null);
    setSelectedSection(null);
    setSelectedChrome(null);
    setDraft(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    setSaved(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG));
    setLifecycle("clean");

    void loadAndSelectInitialVersion();
    // Intentionally reload only when the selected storefront changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storefrontId]);

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

  function handlePublishGatedClick() {
    setNoticeKind("capability");
    setNotice(t("versionPublishGated"));
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
    setVersionCreating(true);
    const result = await createPresentationVersion(storefrontId, name);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // لا تصفّر علَم الإنشاء إلا إن كان لا يزال يخصّ هذا المتجر — وإلا فقد يكون
    // المتجر الحالي بدأ إنشاءً خاصاً به (`versionCreating === true` له)، وهذا
    // الإكمال المتأخر من متجر سابق سيُسكته بصمت فيُفعِّل زرّه قبل اكتمال طلبه.
    if (sameStorefront) setVersionCreating(false);
    if (!result.ok) {
      if (sameStorefront) {
        setNoticeKind("status");
        setNotice(t("versionCreateFailed"));
      }
      return;
    }
    if (!sameStorefront) return; // أُنشئت لمتجر لم يعد معروضاً إطلاقاً — موجودة على الخادم، تظهر عند العودة إليه.
    // تبديل نسخة (الرمز) أو تعديل جديد على المسودة المفتوحة (لا يُغيِّر الرمز)
    // وقع أثناء انتظار الإنشاء — كلاهما يعني أن ما يُعرَض الآن لم يعد يطابق ما
    // كان عليه حين بدأ الطلب، فلا يُفرَض تبنّي النسخة الجديدة عليه؛ صفّها في
    // القائمة يُحدَّث فقط، وتُفتَح لاحقاً صراحةً.
    if (
      tokenAtStart !== versionRequestTokenRef.current ||
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
    setVersionBusy({ id: version.id, action: "duplicate" });
    const result = await createPresentationVersion(storefrontId, name, version.id);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    if (sameStorefront) setVersionBusy(null);
    if (!result.ok) {
      if (sameStorefront) {
        setNoticeKind("status");
        setNotice(t("versionDuplicateFailed"));
      }
      return;
    }
    if (!sameStorefront) return;
    if (
      tokenAtStart !== versionRequestTokenRef.current ||
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
    setVersionBusy({ id: version.id, action: "rename" });
    const result = await renamePresentationVersion(storefrontId, version.id, name, version.revision);
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    // نفس حرص إنشاء/تكرار النسخة: لا تصفّر علَم الانشغال إلا إن كان لا يزال
    // يخصّ هذا المتجر، وإلا فقد يُسكِت بصمت علَم عملية أحدث بدأها متجر آخر.
    if (sameStorefront) setVersionBusy(null);
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
    if (sameStorefront) updateVersionSummaryInList(result.data);
    if (current && wasOpenAtStart) {
      setSelectedVersion(result.data);
    }
  }

  async function handleDeleteVersion(version: PresentationVersionSummary) {
    if (!storefrontId) return;
    const originStorefrontId = storefrontId;
    const tokenAtStart = versionRequestTokenRef.current;
    const wasOpenAtStart = selectedVersion?.id === version.id;
    setVersionBusy({ id: version.id, action: "delete" });
    const result = await deletePresentationVersion(storefrontId, version.id);
    const current = stillCurrent(originStorefrontId, tokenAtStart);
    const sameStorefront = storefrontIdRef.current === originStorefrontId;
    if (sameStorefront) setVersionBusy(null);
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
      if (sameStorefront) {
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
    creating: versionCreating,
    busyVersionId: versionBusy?.id ?? null,
    busyAction: versionBusy?.action ?? null,
    onRetryList: () => {
      void loadAndSelectInitialVersion();
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
  };

  function renderInspectorBody(panelForSlot: CustomizerPanel) {
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
          busy={versionBusy?.action === "duplicate"}
          onCreateDraft={() => {
            const name =
              locale === "ar"
                ? `مسودة من ${selectedVersion.name}`
                : `Draft from ${selectedVersion.name}`;
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
        <InspectorStatusMessage tone="error" onRetry={() => void loadAndSelectInitialVersion()} retryLabel={t("versionReloadLatest")}>
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
      data-lifecycle={lifecycle}
      data-selected-version-id={selectedVersion?.id ?? ""}
      data-selected-version-state={selectedVersion?.state ?? ""}
      data-selected-version-revision={selectedVersion?.revision ?? ""}
      data-panel={panel}
      data-device={effectiveDevice}
      data-selected-section={selectedSection ?? ""}
      data-selected-chrome={selectedChrome ?? ""}
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
          <p className="mt-1 hidden truncate text-[11px] leading-none text-muted md:block">
            <bdi>{liveStoreName ?? t("currentPage")}</bdi> · {t("currentPage")}
          </p>
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
            disabled
            title={t("versionPublishGated")}
            onClick={handlePublishGatedClick}
            className="h-9 shrink-0 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-sm disabled:opacity-40 md:px-3 md:text-sm"
          >
            {t("publish")}
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
            {CUSTOMIZER_NAV_GROUPS.map((group, groupIndex) => (
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
              {CUSTOMIZER_PANELS.map((item) => (
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
              <span className="shrink-0 font-medium text-neutral-700">
                {t("livePreview")}
              </span>
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
              className="h-full min-h-0 overflow-y-auto overscroll-contain p-3 md:overflow-y-scroll md:p-5 xl:p-8"
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
                  liveStoreName={liveStoreName}
                  businessIdentity={businessIdentity}
                  selectedSection={selectedSection}
                  onSelectSection={(key) => handleSelectSection(key, "preview")}
                  selectedChrome={selectedChrome}
                  onSelectChrome={handleSelectChrome}
                />
              </div>
            </div>
            <ScrollIndicator targetRef={canvasScrollRef} />
          </div>
        </section>
      </div>

      {isMobileViewport ? <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 lg:hidden">
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
                ? t("sections")
                : mobileSheet === "design"
                  ? t("design")
                  : mobileSheet === "versions"
                    ? t("versionManagerTitle")
                    : activePanel
                      ? t(activePanel.label)
                      : t("edit")
            }
            className="flex max-h-[86dvh] w-full flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-text">
                {mobileSheet === "sections"
                  ? t("sections")
                  : mobileSheet === "design"
                    ? t("design")
                    : mobileSheet === "versions"
                      ? t("versionManagerTitle")
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
                />
              ) : mobileSheet === "sections" ? (
                renderInspectorBody("homepage")
              ) : (
                renderInspectorBody(mobileSheet === "design" ? "theme" : panel)
              )}
            </div>
          </section>
        </div>
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
