'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft, ArrowRight, Eye, EyeOff, Home, LayoutPanelLeft, Maximize2, Minimize2, Plus, Redo2, RefreshCcw, SlidersHorizontal, Trash2,
  Undo2, UploadCloud,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  addChildComponent, addPage, appDisplayName, cloneWithFreshIds, countNavigationTo, findComponentById, insertChildAfter, findParentId, generatePageId, hasAppBuilderPermission,
  mergeThemeTokens, moveSibling, registryLabel, removeComponentById, removePage, reorderChildren, setInitialPage,
  themeTokens as schemaThemeTokens, updateComponentById,
  type AppBuilderRegistries, type AppSchema, type AppSchemaActionRef, type AppSchemaComponent, type BuilderApp,
  pageNodeMeta, projectPageRoot, updateEditorMetaNode, updateEditorMetaPageTitle,
  type BuilderDraftExperience, type BuilderPublishedVersion, type CompatReport, type ContractIssue, type EditorMeta,
} from '@/lib/app-builder';
import { resolvePreviewActionOutcome } from '@/modules/app-builder/action-semantics';
import { EasyCatalogDialog } from '@/modules/app-builder/easy/easy-catalog-dialog';
import { EasyIdentityPanel } from '@/modules/app-builder/easy/easy-identity-panel';
import { EasyPageActions } from '@/modules/app-builder/easy/easy-page-actions';
import { EasySelectionBar } from '@/modules/app-builder/easy/easy-selection-bar';
import { EasySectionsPanel } from '@/modules/app-builder/easy/easy-sections-panel';
import { readEditorMode, sectionContains, writeEditorMode, type EditorMode } from '@/modules/app-builder/easy/editor-mode';
import { isAddableOnPage, sectionSummary, type EasyCatalogEntry } from '@/modules/app-builder/easy/easy-catalog';
import { buildIssueMarkers, IssueMarkersProvider } from '@/modules/app-builder/issue-markers';
import { ContractIssuesList, ContractIssuesNotice, parseContractIssues } from '@/modules/app-builder/contract-issues';
import { CompatDisclosure, CompatNotice, compatNeedsAttention } from '@/modules/app-builder/compat-report';
import { AppBuilderCanvas, PREVIEW_WIDTHS, type PreviewDevice } from '@/modules/app-builder/canvas';
import { DEFAULT_APP_EXPERIENCE } from '@/modules/app-builder/default-experience';
import { DeviceFrame, DEVICE_FRAME_PRESETS, type DeviceFramePreset } from '@/modules/app-builder/device-frame';
import { LayersTree } from '@/modules/app-builder/layers-tree';
import { Inspector } from '@/modules/app-builder/inspector';
import { PreviewOnPhoneButton } from '@/modules/app-builder/preview-on-phone';
import {
  classifySaveError, clearDraftBackup, clearDraftBackupIfSaved, draftStatesEqual, parseDraftConflict, readDraftBackup, writeDraftBackup,
  type DraftBackup,
} from '@/modules/app-builder/draft-save';
import { DraftConflictDialog, LeaveGuardDialog, RecoverBackupDialog, type ConflictState } from '@/modules/app-builder/draft-save-dialogs';
import { useUnsavedChangesGuard } from '@/modules/app-builder/unsaved-guard';
import { ThemePanel } from '@/modules/app-builder/theme-panel';

type MobilePanel = 'structure' | 'inspector';
type StructureMode = 'pages' | 'theme' | 'identity';
/**
 * MOBILE-PREVIEW-3 — المحور العلوي الجديد المستقل عن `PreviewState` أدناه: `design` هو
 * سطح التحرير الحالي بلا أي تغيير (`AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` §2/6).
 * `preview` هو «معاينة التطبيق» — سطح غير قابل للتحرير إطلاقاً بصرف النظر عن `PreviewState`
 * المختار (مسودة/منشورة/افتراضية تبقى تُختار داخل المعاينة، لكن العرض دوماً قراءة فقط).
 * هذا Level B — Browser Mobile Preview فقط (`REAL-MOBILE-PREVIEW-2-...md` §8/MP2-D1)، لا
 * زمن تشغيل Flutter حقيقي ولا بيانات متجر حيّة — كلاهما مؤجَّل صراحةً لمهام لاحقة.
 */
type BuilderMode = 'design' | 'preview';
/**
 * LIVE-PREVIEW-6 — أيّ نسخة يعرضها الكانفاس حالياً. `draft` هو الوضع الوحيد القابل
 * للتحرير (المسار الموجود أصلاً، بلا تغيير). `published`/`default` قراءة فقط بالكامل —
 * لا تُستدعى أيٌّ من دوال `apply*`/`handleSave`/`confirmPublish` وهما معروضان، فلا خطر
 * تحرير خفي يستهدف مخططاً غير المسودة الفعلية.
 */
type PreviewState = 'draft' | 'published' | 'default';
const HISTORY_LIMIT = 50;

/**
 * APP-BUILDER-6 — يبني على هيكل APP-BUILDER-5 (لا تغيير في الشكل/الاستجابة) ويضيف
 * تحرير المخطط فعلياً: تحديد/إضافة/حذف/إعادة ترتيب، خصائص وإجراءات قابلة للتحرير في
 * الـ Inspector، تراجع/إعادة محدودان، وحفظ صريح عبر `PUT /app-builder/apps/{id}/draft`
 * الموجود أصلاً منذ APP-BUILDER-1. انظر `APP-BUILDER-6-UX-EVIDENCE-PASS.md`.
 */
/** الصفحة الرئيسية للمخطط إن وُجدت وإلا أول صفحة. */
function pickInitialPageId(schema: AppSchema): string | null {
  const initialPageId = schema.navigation?.initialPageId ?? null;
  return initialPageId && schema.pages[initialPageId] ? initialPageId : Object.keys(schema.pages)[0] ?? null;
}

export default function AppBuilderWorkspacePage() {
  const t = useTranslations('appBuilder.builder');
  const tc = useTranslations('common');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const toast = useToast();

  const [app, setApp] = useState<BuilderApp | null>(null);
  const [registries, setRegistries] = useState<AppBuilderRegistries | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schema, setSchema] = useState<AppSchema | null>(null);
  const pastRef = useRef<AppSchema[]>([]);
  const futureRef = useRef<AppSchema[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // AD-01 / S01b — الأساس التفاؤلي للحفظ: `revision` كما قرأه المحرر آخر مرة (من التحميل أو من آخر حفظ ناجح).
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const baseRevisionRef = useRef<number | null>(null);
  const schemaRef = useRef<AppSchema | null>(null);
  // AD-05: بيانات المحرر مرتبطة بهوية كائن المخطط (WeakMap) فيشملها سجلّ التراجع/الإعادة تلقائياً دون تغيير بنيته.
  const metaRegistry = useRef(new WeakMap<AppSchema, EditorMeta | null>());
  const metaOf = (value: AppSchema | null): EditorMeta | null => (value ? metaRegistry.current.get(value) ?? null : null);
  const withMeta = (next: AppSchema, meta: EditorMeta | null): AppSchema => {
    metaRegistry.current.set(next, meta);
    return next;
  };
  const dirtyRef = useRef(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [saveFailure, setSaveFailure] = useState<'network' | 'other' | null>(null);
  const [recovery, setRecovery] = useState<DraftBackup | null>(null);
  const canManage = hasAppBuilderPermission(currentUser(), 'apps_builder.manage');
  const backupUserId = currentUser()?.id ?? 'anonymous';

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState<'ar' | 'en'>('ar');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('structure');
  const [structureMode, setStructureMode] = useState<StructureMode>('pages');
  // الوضع السهل/المتقدم (V2): تفضيل عرض لكل مستخدم/تطبيق، لا يمسّ المسودة. القراءة بعد التركيب (تجنّب اختلاف الـhydration).
  const [editorMode, setEditorModeState] = useState<EditorMode>('easy');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // «تراجع عن الحذف» يُعرض ما دام الحذف آخر تعديل: يُلتقط مخطط ما بعد الحذف، وأي مخطط مختلف لاحقاً يُبطله (مراجعة Codex).
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [deleteUndo, setDeleteUndo] = useState<{ name: string; schema: AppSchema } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [validation, setValidation] = useState<{ status: 'checking' | 'passed' | 'failed'; message?: string; issues?: ContractIssue[]; compat?: CompatReport | null }>({ status: 'checking' });
  // AD-12: مشكلات العقد في آخر نسخة محفوظة (من استجابة GET/PUT للمسودة)؛ معلوماتية ولا تمنع الحفظ.
  const [contractIssues, setContractIssues] = useState<ContractIssue[]>([]);
  // S03b: تقرير التوافق الاستشاري لآخر نسخة محفوظة (ما سيُحذف على كل جيل Runtime) — لا يمنع شيئاً.
  const [compat, setCompat] = useState<CompatReport | null>(null);
  const [publishing, setPublishing] = useState(false);
  const canPublish = hasAppBuilderPermission(currentUser(), 'apps_builder.publish');
  const [previewThemeTokens, setPreviewThemeTokens] = useState<Record<string, string> | null>(null);

  const [previewState, setPreviewState] = useState<PreviewState>('draft');
  const [publishedVersion, setPublishedVersion] = useState<BuilderPublishedVersion | null>(null);
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [publishedError, setPublishedError] = useState<string | null>(null);
  const [viewedPageId, setViewedPageId] = useState<string | null>(null);

  // MOBILE-PREVIEW-3 — App Preview shell state. `builderMode` never mutates `previewState`
  // and vice versa: switching to Preview keeps whichever source (draft/published/default)
  // was already selected, and returning to Design restores the exact same editor state
  // (selection, dirty flag, history) — nothing here is cleared or reset on mode switch.
  const [builderMode, setBuilderMode] = useState<BuilderMode>('design');
  const [previewDevicePreset, setPreviewDevicePreset] = useState<DeviceFramePreset>('iphone');
  const [fullPreview, setFullPreview] = useState(false);

  /**
   * APP-BUILDER-PREVIEW-UX-1 — Design mode's own side-by-side mobile frame (the UX
   * decision's §2 "editing controls and a mobile device frame in the same working
   * context"), kept entirely separate from the existing full "App Preview" shell above.
   * `isWideBuilderViewport` is a real JS `matchMedia` check — never a CSS-only `hidden
   * xl:flex` class — because this pane renders a second, read-only copy of the exact
   * same canvas content Design mode's editable canvas already shows; a CSS-only hide
   * would still mount it (and duplicate every visible string) in any environment that
   * doesn't apply stylesheets, breaking existing single-match lookups elsewhere on this
   * page. The same pattern already ships in `components/layout/sidebar.tsx`. Defaults to
   * `false` so a narrow viewport (and a test environment with no `matchMedia` override)
   * never mounts the second canvas at all.
   */
  const [isWideBuilderViewport, setIsWideBuilderViewport] = useState(false);
  const [showInlinePreview, setShowInlinePreview] = useState(true);
  const [inlinePreviewPageId, setInlinePreviewPageId] = useState<string | null>(null);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const syncViewport = () => setIsWideBuilderViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api<{ data: BuilderApp }>(`/app-builder/apps/${params.id}`),
      api<{ data: BuilderDraftExperience; issues?: ContractIssue[]; compat?: CompatReport | null }>(`/app-builder/apps/${params.id}/draft`),
      api<{ data: AppBuilderRegistries }>('/app-builder/registries'),
    ])
      .then(([appRes, draftRes, registriesRes]) => {
        setApp(appRes.data);
        setSchema(withMeta(draftRes.data.schema, draftRes.data.editor_meta ?? null));
        setContractIssues(draftRes.issues ?? []);
        setCompat(draftRes.compat ?? null);
        baseRevisionRef.current = draftRes.data.revision;
        setBaseRevision(draftRes.data.revision);
        setConflict(null);
        setSaveFailure(null);
        // نسخة محلية احتياطية لتعديلات لم تُحفظ (إغلاق/انهيار/فشل شبكة/تعارض سابق): تُعرض للاستعادة لا تُطبَّق صامتةً.
        const backup = readDraftBackup(backupUserId, params.id);
        if (backup && !draftStatesEqual({ schema: backup.schema, editorMeta: backup.editorMeta ?? null }, { schema: draftRes.data.schema, editorMeta: draftRes.data.editor_meta ?? null })) setRecovery(backup);
        else {
          if (backup) clearDraftBackup(backupUserId, params.id);
          setRecovery(null);
        }
        pastRef.current = [];
        futureRef.current = [];
        setDirty(false);
        setEditorModeState(readEditorMode(backupUserId, params.id));
        setStructureMode('pages');
        setPreviewThemeTokens(null);
        setRegistries(registriesRes.data);
        const pageId = pickInitialPageId(draftRes.data.schema);
        setSelectedPageId(pageId);
        setSelectedComponentId(pageId ? draftRes.data.schema.pages[pageId].id : null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t, backupUserId]);

  useEffect(() => load(), [load]);

  schemaRef.current = schema;
  dirtyRef.current = dirty;
  useEffect(() => {
    if (pendingDeleteName !== null && schema) {
      setDeleteUndo({ name: pendingDeleteName, schema });
      setPendingDeleteName(null);
    } else if (deleteUndo && schema !== deleteUndo.schema) {
      setDeleteUndo(null);
    }
  }, [schema, pendingDeleteName, deleteUndo]);
  // حارس المغادرة: beforeunload + الروابط الداخلية + زر الرجوع (AD-01 / S01b).
  const leaveGuard = useUnsavedChangesGuard(dirty);

  // نسخة محلية احتياطية مؤجَّلة لكل تعديل غير محفوظ، وتُكتب فوراً عند إخفاء الصفحة؛ تُمسح عند الحفظ الناجح أو التجاهل الصريح.
  useEffect(() => {
    if (!schema || !dirty || !params.id || baseRevision === null) return;
    const handle = window.setTimeout(() => writeDraftBackup(backupUserId, params.id, schema, baseRevision, metaOf(schema)), 400);
    return () => window.clearTimeout(handle);
  }, [schema, dirty, baseRevision, params.id, backupUserId]);

  const flushBackupNow = useCallback(() => {
    const current = schemaRef.current;
    if (current && dirtyRef.current && params.id && baseRevisionRef.current !== null) {
      writeDraftBackup(backupUserId, params.id, current, baseRevisionRef.current, metaOf(current));
    }
  }, [params.id, backupUserId]);
  const flushBackupRef = useRef(flushBackupNow);
  flushBackupRef.current = flushBackupNow;

  useEffect(() => {
    // pagehide لا يُطلَق عند تنقل Next من جهة العميل (Back المؤكَّد)، فنفرّغ أيضاً عند فك التركيب.
    const onPageHide = () => flushBackupRef.current();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flushBackupRef.current();
    };
  }, []);

  const applyPageEdit = useCallback(
    (pageId: string, updater: (pageRoot: AppSchemaComponent) => AppSchemaComponent, metaUpdater?: (meta: EditorMeta | null) => EditorMeta | null) => {
      if (!schema || !canManage) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      const meta = metaOf(schema);
      setSchema(withMeta({ ...schema, pages: { ...schema.pages, [pageId]: updater(schema.pages[pageId]) } }, metaUpdater ? metaUpdater(meta) : meta));
    },
    [schema, canManage]
  );

  /** تعديل بيانات المحرر وحدها (إخفاء/اسم/عنوان صفحة) — خطوة تراجع كاملة، والمخطط نفسه لا يتغير (كائن جديد بالمحتوى نفسه). */
  const applyMetaEdit = useCallback(
    (metaUpdater: (meta: EditorMeta | null) => EditorMeta | null) => {
      if (!schema || !canManage) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema(withMeta({ ...schema }, metaUpdater(metaOf(schema))));
    },
    [schema, canManage]
  );

  const applyThemeEdit = useCallback(
    (patch: Record<string, string>) => {
      if (!schema || !canManage) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema(withMeta(mergeThemeTokens(schema, patch), metaOf(schema)));
    },
    [schema, canManage]
  );

  /** أساس عمليات صفحات المخطط (إضافة/حذف/تعيين رئيسية) — نفس مسار السجلّ/التعديل. */
  const applyPagesEdit = useCallback(
    (updater: (current: AppSchema) => AppSchema) => {
      if (!schema || !canManage) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema(withMeta(updater(schema), metaOf(schema)));
    },
    [schema, canManage]
  );

  const undo = useCallback(() => {
    if (!schema || !canManage || pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [schema, ...futureRef.current];
    setDirty(true);
    setSchema(previous);
  }, [schema, canManage]);

  const redo = useCallback(() => {
    if (!schema || !canManage || futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
    setDirty(true);
    setSchema(next);
  }, [schema, canManage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editingText = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (editingText) return;
      const meta = event.ctrlKey || event.metaKey;
      if (!meta || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  /**
   * AD-01 — يحفظ المسودة بأساس تفاؤلي `base_revision`. التعارض (409) لا يكتب شيئاً ولا يمسح التعديلات المحلية: يفتح حوار الحل.
   * فشل الشبكة/الخادم يُبقي `dirty` والنسخة المحلية الاحتياطية ويعرض خطأً دائماً قابلاً لإعادة المحاولة.
   */
  async function persistDraft(overrideBase?: number): Promise<'ok' | 'conflict' | 'failed'> {
    const toSave = schemaRef.current;
    if (!toSave || !params.id) return 'failed';
    const base = overrideBase ?? baseRevisionRef.current;
    const sentMeta = metaOf(toSave); // ما أُرسل فعلاً: به يُقارَن النسخ الاحتياطي (الخادم قد يقصّ معرّفات غير موجودة).
    try {
      const res = await api<{ data: BuilderDraftExperience; issues?: ContractIssue[]; compat?: CompatReport | null }>(`/app-builder/apps/${params.id}/draft`, {
        method: 'PUT',
        body: base === null ? { schema: toSave, editor_meta: sentMeta } : { schema: toSave, base_revision: base, editor_meta: sentMeta },
      });
      const saved = res?.data;
      setContractIssues(res?.issues ?? []);
      setCompat(res?.compat ?? null);
      // الخادم ينظّف بيانات المحرر (يقصّ معرّفات لم تعد في المخطط)؛ نسخته هي المرجع لما حُفظ.
      if (saved && 'editor_meta' in saved) metaRegistry.current.set(toSave, saved.editor_meta ?? null);
      if (saved && typeof saved.revision === 'number') {
        baseRevisionRef.current = saved.revision;
        setBaseRevision(saved.revision);
      }
      // تعديلات أُجريت أثناء الطلب لا تُعدّ محفوظة.
      if (schemaRef.current === toSave) {
        setDirty(false);
        clearDraftBackupIfSaved(backupUserId, params.id, toSave, sentMeta);
      }
      setSaveFailure(null);
      setConflict(null);
      toast.success(t('saveSuccessTitle'));
      return 'ok';
    } catch (err) {
      const info = parseDraftConflict(err);
      if (info) {
        setConflict((previous) => ({ info, stage: 'choose', latest: null, busy: false, changedAgain: previous?.stage === 'confirmOverwrite' }));
        // الأحدث لا لقطة الطلب: قد يكون المستخدم تابع الكتابة أثناء الحفظ البطيء ونسخته المحلية أحدث.
        if (baseRevisionRef.current !== null) writeDraftBackup(backupUserId, params.id, schemaRef.current ?? toSave, baseRevisionRef.current, metaOf(schemaRef.current ?? toSave));
        return 'conflict';
      }
      const kind = classifySaveError(err);
      if (kind === 'network' || kind === 'other') setSaveFailure(kind);
      toast.error(t('saveErrorTitle'), err instanceof ApiError ? err.message : t('saveNetworkHint'));
      if (baseRevisionRef.current !== null) writeDraftBackup(backupUserId, params.id, schemaRef.current ?? toSave, baseRevisionRef.current, metaOf(schemaRef.current ?? toSave));
      return 'failed';
    }
  }

  async function handleSave() {
    if (!schema || !params.id || !canManage || saving) return;
    setSaving(true);
    setSaveFailure(null);
    try {
      await persistDraft();
    } finally {
      setSaving(false);
    }
  }

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  /** الكتابة فوق: إعادة جلب أحدث revision أولاً ثم تأكيد المستخدم، ولا يُرسَل شيء قبلهما. */
  async function startOverwrite() {
    if (!params.id) return;
    setConflict((c) => (c ? { ...c, busy: true } : c));
    try {
      const res = await api<{ data: BuilderDraftExperience }>(`/app-builder/apps/${params.id}/draft`);
      setConflict((c) => (c ? { ...c, busy: false, stage: 'confirmOverwrite', latest: { revision: res.data.revision, updatedAt: res.data.updated_at } } : c));
    } catch (err) {
      setConflict((c) => (c ? { ...c, busy: false } : c));
      toast.error(t('conflict.fetchLatestFailed'), err instanceof ApiError ? err.message : undefined);
    }
  }

  async function confirmOverwrite() {
    const latest = conflict?.latest;
    if (!latest) return;
    setConflict((c) => (c ? { ...c, busy: true } : c));
    setSaving(true);
    try {
      await persistDraft(latest.revision);
    } finally {
      setSaving(false);
      setConflict((c) => (c ? { ...c, busy: false } : c));
    }
  }

  function confirmReloadLatest() {
    if (params.id) clearDraftBackup(backupUserId, params.id);
    setConflict(null);
    load();
  }

  async function copyMyChanges() {
    try {
      // بيانات المحرر (إخفاء/اسم/عنوان صفحة) جزء من «تعديلاتي»: تُصدَّر معها حين توجد، وإلا يبقى المخطط وحده كما كان.
      const current = schemaRef.current ?? schema;
      const meta = metaOf(current);
      await navigator.clipboard.writeText(JSON.stringify(meta ? { schema: current, editor_meta: meta } : current, null, 2));
      toast.success(t('conflict.copied'));
    } catch {
      toast.error(t('conflict.copyFailed'));
    }
  }

  function restoreLocalBackup() {
    if (!recovery) return;
    baseRevisionRef.current = recovery.baseRevision;
    setBaseRevision(recovery.baseRevision);
    pastRef.current = [];
    futureRef.current = [];
    setSchema(withMeta(recovery.schema, recovery.editorMeta ?? null));
    // النسخة المستعادة قد تحذف/تغيّر الصفحة المحدَّدة من مسودة الخادم؛ التحديد يُعاد من المخطط المستعاد وإلا ظهر الكانفاس فارغاً.
    const pageId = pickInitialPageId(recovery.schema);
    setSelectedPageId(pageId);
    setSelectedComponentId(pageId ? recovery.schema.pages[pageId].id : null);
    setDirty(true);
    setRecovery(null);
  }

  function discardLocalBackup() {
    if (params.id) clearDraftBackup(backupUserId, params.id);
    setRecovery(null);
  }

  // Ctrl/Cmd+S يحفظ المسودة (ويمنع حوار «حفظ الصفحة» في المتصفح) حتى أثناء الكتابة داخل حقل.
  useEffect(() => {
    function onSaveShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (dirty && canManage && builderMode === 'design' && previewState === 'draft') void handleSaveRef.current();
    }
    window.addEventListener('keydown', onSaveShortcut);
    return () => window.removeEventListener('keydown', onSaveShortcut);
  }, [dirty, canManage, builderMode, previewState]);

  /** يفتح حوار النشر ويشغّل الفحص الصريح فوراً — لا زرّ تأكيد مفعّلاً قبل نجاحه. */
  function openPublishDialog() {
    setPublishNote('');
    setPublishOpen(true);
    runValidate();
  }

  async function runValidate() {
    if (!params.id) return;
    setValidation({ status: 'checking' });
    try {
      const checked = await api<{ compat?: CompatReport | null }>(`/app-builder/apps/${params.id}/validate`, { method: 'POST' });
      setValidation({ status: 'passed', compat: checked?.compat ?? null });
    } catch (err) {
      const issues = err instanceof ApiError ? parseContractIssues(err.body) : null;
      setValidation({ status: 'failed', message: err instanceof ApiError ? err.message : t('publish.validateErrorGeneric'), ...(issues ? { issues } : {}) });
    }
  }

  async function confirmPublish() {
    if (!params.id || validation.status !== 'passed') return;
    setPublishing(true);
    try {
      await api(`/app-builder/apps/${params.id}/versions`, {
        method: 'POST',
        // AD-01 / S01d: ننشر ما راجعناه فقط — إن تغيّرت المسودة منذ آخر قراءة/حفظ لنا يردّ الخادم 409 ولا تُنشأ نسخة.
        body: { note: publishNote.trim() || undefined, expected_draft_revision: baseRevisionRef.current ?? undefined },
      });
      setPublishOpen(false);
      toast.success(t('publish.successTitle'));
      // LIVE-PREVIEW-6: يُبطِل ذاكرة النسخة المنشورة المخبّأة — نشرٌ ناجح جديد يعني أن
      // "أحدث نسخة" تغيّرت؛ إعادة الجلب تُطلَب في المرة التالية التي يُفتَح فيها تبويب
      // «منشورة» بدل الاستمرار بعرض النسخة القديمة المخبّأة.
      setPublishedVersion(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { reason?: string } | null)?.reason === 'draft_changed_since_review') {
        setPublishOpen(false);
        toast.error(t('publish.draftChangedTitle'), t('publish.draftChangedBody'));
      } else {
        toast.error(t('publish.errorTitle'), err instanceof ApiError ? err.message : undefined);
      }
    } finally {
      setPublishing(false);
    }
  }

  /**
   * LIVE-PREVIEW-6 — يبدّل حالة المعاينة. `published` تجلب أحدث نسخة منشورة مرّة واحدة
   * فقط وتخبّئها (تُبطَل عند نشر ناجح جديد، أعلاه) — نفس مساري `GET .../versions` +
   * `GET .../versions/{version}` الموجودَين أصلاً لصفحة سجلّ النسخ، لا مسار جديد.
   */
  async function switchPreviewState(next: PreviewState) {
    setPreviewState(next);
    if (next === 'default') {
      setViewedPageId(DEFAULT_APP_EXPERIENCE.navigation.initialPageId);
      return;
    }
    if (next !== 'published' || publishedVersion || !params.id) return;
    setPublishedLoading(true);
    setPublishedError(null);
    try {
      const list = await api<{ data: BuilderPublishedVersion[] }>(`/app-builder/apps/${params.id}/versions`);
      const latest = list.data.reduce<BuilderPublishedVersion | null>(
        (best, version) => (!best || version.version > best.version ? version : best),
        null
      );
      if (!latest) {
        setPublishedError(t('previewState.noPublishedVersion'));
        return;
      }
      const full = await api<{ data: BuilderPublishedVersion }>(`/app-builder/apps/${params.id}/versions/${latest.version}`);
      setPublishedVersion(full.data);
      setViewedPageId(full.data.schema?.navigation.initialPageId ?? null);
    } catch (err) {
      setPublishedError(err instanceof ApiError ? err.message : t('previewState.loadFailed'));
    } finally {
      setPublishedLoading(false);
    }
  }

  /**
   * APP-BUILDER-PREVIEW-UX-1 — «تحديث المعاينة»: يعيد مزامنة إطار المعاينة من حالة
   * المسودة المدعومة حالياً — **بلا نشر وبلا أي كتابة على المسودة أو النسخة المنشورة
   * إطلاقاً** (كل استدعاء هنا `GET`). ثلاث خطوات حقيقية، لا مجرّد مؤشّر تحميل تجميلي:
   * (1) يعيد جلب سجلّات المكوّنات/الإجراءات طازجةً — لو تغيّر سجلّ المنصّة نفسه بين
   * جلستي عمل، هذا هو مسار التقاطه دون إعادة تحميل الصفحة كاملةً؛ (2) عند عرض نسخة
   * «منشورة»، يُبطِل ذاكرة `publishedVersion` المخبّأة محلياً ويعيد جلب أحدث نسخة فعلياً
   * — تحديداً الحالة التي يعالجها «تحديث المعاينة» في القرار المعتمَد: نشرٌ من جلسة أخرى
   * لن يظهر هنا أبداً من دون هذا التحديث اليدوي؛ (3) يعيد تنقّل إطار المعاينة المضمَّن
   * (`inlinePreviewPageId`) إلى الصفحة قيد التحرير ويزيد `previewRefreshKey` لإعادة
   * تركيب شجرة الكانفاس بالكامل، فتُمحى أي حالة داخلية عالقة لمكوّن مخصَّص.
   */
  async function refreshPreview() {
    if (!params.id) return;
    setRefreshingPreview(true);
    try {
      const registriesRes = await api<{ data: AppBuilderRegistries }>('/app-builder/registries');
      setRegistries(registriesRes.data);

      if (previewState === 'published') {
        setPublishedLoading(true);
        setPublishedError(null);
        try {
          const list = await api<{ data: BuilderPublishedVersion[] }>(`/app-builder/apps/${params.id}/versions`);
          const latest = list.data.reduce<BuilderPublishedVersion | null>(
            (best, version) => (!best || version.version > best.version ? version : best),
            null
          );
          if (!latest) {
            setPublishedError(t('previewState.noPublishedVersion'));
          } else {
            const full = await api<{ data: BuilderPublishedVersion }>(`/app-builder/apps/${params.id}/versions/${latest.version}`);
            setPublishedVersion(full.data);
            setViewedPageId(full.data.schema?.navigation.initialPageId ?? null);
          }
        } finally {
          setPublishedLoading(false);
        }
      }

      setInlinePreviewPageId(null);
      setPreviewRefreshKey((key) => key + 1);
      toast.success(t('preview.refreshSuccessTitle'));
    } catch (err) {
      toast.error(t('preview.refreshErrorTitle'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setRefreshingPreview(false);
    }
  }

  const pageIds = useMemo(() => (schema ? Object.keys(schema.pages) : []), [schema]);
  // شارات المشكلات للصفحة المعروضة (الشجرة وقائمة الأقسام) — معلوماتية من آخر نسخة محفوظة. (قبل أي return مبكر: قواعد الـhooks.)
  const issueMarkers = useMemo(() => buildIssueMarkers(contractIssues, selectedPageId), [contractIssues, selectedPageId]);
  const viewedSchema: AppSchema | null =
    previewState === 'published' ? publishedVersion?.schema ?? null : previewState === 'default' ? DEFAULT_APP_EXPERIENCE : null;
  const viewedPageIds = useMemo(() => (viewedSchema ? Object.keys(viewedSchema.pages) : []), [viewedSchema]);
  const effectiveViewedPageId =
    viewedPageId && viewedSchema?.pages[viewedPageId] ? viewedPageId : viewedSchema?.navigation.initialPageId ?? null;
  const viewedPageRoot = viewedSchema && effectiveViewedPageId ? viewedSchema.pages[effectiveViewedPageId] ?? null : null;
  const currentPageRoot = schema && selectedPageId ? schema.pages[selectedPageId] ?? null : null;
  // بيانات المحرر (AD-05) والجذر **المُسقَط**: ما يراه التاجر في الكانفاس والمعاينة هو ما يُنشر (الأقسام المخفية خارجه).
  const editorMeta = metaOf(schema);
  const projectedPageRoot = currentPageRoot && selectedPageId ? projectPageRoot(currentPageRoot, editorMeta, selectedPageId) : null;
  const nodeMeta = pageNodeMeta(editorMeta, selectedPageId);
  const selectedNode = currentPageRoot && selectedComponentId ? findComponentById(currentPageRoot, selectedComponentId) : null;
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  /**
   * APP-BUILDER-PREVIEW-UX-1 — Design mode's inline mobile frame always mirrors the live
   * Draft (`schema`), never `previewState`/`viewedPageId` — it is a second, read-only
   * window onto the exact page being edited, not another "App Preview" source selector.
   * `inlinePreviewPageId` is `null` by default ("follow whatever page is selected for
   * editing"); tapping an in-frame nav action (`handleInlinePreviewAction` below) can
   * decouple it, exactly mirroring `handlePreviewAction`'s own draft branch — including
   * its safe degrade to `null`/"Empty page" for a well-formed-but-missing target id,
   * never a crash or a fabricated page.
   */
  const inlineEffectivePageId = inlinePreviewPageId ?? selectedPageId;
  const inlinePreviewRootRaw = schema && inlineEffectivePageId ? schema.pages[inlineEffectivePageId] ?? null : null;
  const inlinePreviewRoot = inlinePreviewRootRaw && inlineEffectivePageId ? projectPageRoot(inlinePreviewRootRaw, editorMeta, inlineEffectivePageId) : null;

  /** يبدّل وضع لوحة البنية — يلغي أي معاينة مزامنة مظهر معلّقة عند مغادرة تبويب المظهر، فلا تبقى معلَّقة على كانفاس لم يعد يُظهر أدواتها. */
  function switchStructureMode(mode: StructureMode) {
    setStructureMode(mode);
    if (mode !== 'theme') setPreviewThemeTokens(null);
  }

  function selectPage(pageId: string) {
    if (!schema) return;
    switchStructureMode('pages');
    setSelectedPageId(pageId);
    setSelectedComponentId(schema.pages[pageId]?.id ?? null);
    // Picking a different page to edit immediately re-syncs the inline mobile preview to
    // follow it — the one case `inlinePreviewPageId` resets to "follow the editor" on its
    // own, no manual Refresh needed (per the UX decision's "simple/safe edits auto-refresh").
    setInlinePreviewPageId(null);
  }

  /** التحديد من الشجرة/الكانفاس يعيد لوحة الفحص دوماً لوضع «الصفحات» — لا يبقى التحديد يتغيّر خلف تبويب المظهر بصمت. */
  function selectComponent(id: string) {
    switchStructureMode('pages');
    setSelectedComponentId(id);
  }

  /** يضيف صفحة فارغة جديدة ويحدّدها مباشرة. */
  function addNewPage() {
    if (!schema || !canManage) return;
    const pageId = generatePageId();
    applyPagesEdit((current) => addPage(current, pageId));
    setSelectedPageId(pageId);
    setSelectedComponentId(`${pageId}-root`);
  }

  /** يحذف صفحة — لا تأثير على الصفحة الرئيسية أو آخر صفحة متبقية (`removePage` نفسه صامت، والزر معطّل أصلاً في هذه الحالات). إن كانت الصفحة المحذوفة هي المحدَّدة، يعاد التحديد إلى الصفحة الرئيسية الباقية دوماً. */
  function deletePage(pageId: string) {
    if (!schema || !canManage) return;
    applyPagesEdit((current) => removePage(current, pageId));
    if (selectedPageId === pageId) {
      const fallbackId = schema.navigation.initialPageId;
      setSelectedPageId(fallbackId);
      setSelectedComponentId(schema.pages[fallbackId]?.id ?? null);
    }
  }

  function makeInitialPage(pageId: string) {
    if (!canManage) return;
    applyPagesEdit((current) => setInitialPage(current, pageId));
  }

  function updateSelectedNode(nextNode: AppSchemaComponent) {
    if (!selectedPageId || !selectedComponentId) return;
    applyPageEdit(selectedPageId, (root) => updateComponentById(root, selectedComponentId, () => nextNode));
  }

  function addChildToSelected(newNode: AppSchemaComponent) {
    if (!selectedPageId || !selectedComponentId) return;
    applyPageEdit(selectedPageId, (root) => addChildComponent(root, selectedComponentId, newNode));
    setSelectedComponentId(newNode.id);
  }

  function removeSelected() {
    if (!canManage || !selectedPageId || !selectedComponentId || !currentPageRoot || selectedComponentId === currentPageRoot.id) return;
    const targetId = selectedComponentId;
    const parentId = findParentId(currentPageRoot, targetId) ?? currentPageRoot.id;
    applyPageEdit(selectedPageId, (root) => removeComponentById(root, targetId));
    setSelectedComponentId(parentId);
  }

  function setEditorMode(mode: EditorMode) {
    setEditorModeState(mode);
    if (params.id) writeEditorMode(backupUserId, params.id, mode);
  }

  async function renameApp(name: string, nameEn: string | null) {
    if (!canManage || !params.id || renaming) return;
    setRenaming(true);
    try {
      const res = await api<{ data: BuilderApp }>(`/app-builder/apps/${params.id}`, { method: 'PATCH', body: { name, name_en: nameEn } });
      if (res?.data) setApp(res.data);
      toast.success(t('easy.identity.saved'));
    } catch (err) {
      toast.error(t('easy.identity.saveFailed'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setRenaming(false);
    }
  }

  /** الأقسام = أبناء جذر الصفحة المباشرون (الوضع السهل). كل تعديل عبر applyPageEdit نفسه (تراجع/حفظ تفاؤلي/صلاحيات). */
  function easyDuplicate(id: string) {
    if (!canManage || !selectedPageId || !currentPageRoot) return;
    const source = findComponentById(currentPageRoot, id);
    if (!source) return;
    const pageId = selectedPageId;
    const copy = cloneWithFreshIds(source);
    // النسخة تحمل اسم القسم ونوعه الجاهز (لا الإخفاء: نسخة جديدة ظاهرة)؛ معرّفها جديد فلا تلتبس ببيانات الأصل.
    const original = pageNodeMeta(metaOf(schema), selectedPageId)[id];
    const carry = original && (original.name || original.preset) ? { name: original.name, preset: original.preset } : null;
    applyPageEdit(
      selectedPageId,
      (root) => insertChildAfter(root, root.id, id, copy),
      carry ? (meta) => updateEditorMetaNode(meta, pageId, copy.id, carry) : undefined,
    );
    setSelectedComponentId(copy.id);
  }

  function easyDelete(id: string, name: string) {
    if (!canManage || !selectedPageId || !currentPageRoot) return;
    applyPageEdit(selectedPageId, (root) => removeComponentById(root, id));
    setSelectedComponentId(currentPageRoot.id);
    setPendingDeleteName(name);
  }

  function easyToggleHidden(id: string) {
    if (!canManage || !selectedPageId) return;
    const pageId = selectedPageId;
    const hidden = pageNodeMeta(metaOf(schema), pageId)[id]?.hidden === true;
    applyMetaEdit((meta) => updateEditorMetaNode(meta, pageId, id, { hidden: !hidden }));
  }

  function easyRename(id: string, name: string) {
    if (!canManage || !selectedPageId) return;
    const pageId = selectedPageId;
    applyMetaEdit((meta) => updateEditorMetaNode(meta, pageId, id, { name }));
  }

  function easyRenamePage(title: string) {
    if (!canManage || !selectedPageId) return;
    const pageId = selectedPageId;
    applyMetaEdit((meta) => updateEditorMetaPageTitle(meta, pageId, title));
  }

  function easyUndoDelete() {
    undo();
    setDeleteUndo(null);
  }

  function easyAdd(entry: EasyCatalogEntry) {
    if (!canManage || !selectedPageId || !currentPageRoot || !entry.build || !isAddableOnPage(entry, selectedPageId)) return;
    const created = entry.build();
    // بعد القسم المحدد (أو أحد أبنائه)، وإلا في النهاية.
    const afterId = (currentPageRoot.children ?? []).find((section) => findComponentById(section, selectedComponentId ?? '') !== null)?.id ?? null;
    // النوع الجاهز (Preset) يُسجَّل في بيانات المحرر لا في المخطط: يميّز القسم الذي بُني من الكتالوج دون مفتاح جديد في AppSchema.
    const pageId = selectedPageId;
    applyPageEdit(
      pageId,
      (root) => insertChildAfter(root, root.id, afterId, created),
      (meta) => updateEditorMetaNode(meta, pageId, created.id, { preset: entry.key }),
    );
    setSelectedComponentId(created.id);
    setCatalogOpen(false);
  }

  function reorderSiblings(pageId: string, parentId: string, orderedIds: string[]) {
    applyPageEdit(pageId, (root) => reorderChildren(root, parentId, orderedIds));
  }

  function moveNode(pageId: string, id: string, direction: 'up' | 'down') {
    applyPageEdit(pageId, (root) => moveSibling(root, id, direction));
  }

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;
  if (!app || !schema || !registries) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

  // MOBILE-PREVIEW-3 — App Preview always renders read-only, for whichever `previewState`
  // is selected, including `draft`: unlike Design mode (where `draft` is the one editable
  // branch), Preview never calls `onSelect`/mutates the schema, so the draft's own live
  // `currentPageRoot`/`schema` can be shown safely without a second fetch or a second
  // "viewed" tracking variable — `published`/`default` keep using the existing
  // `viewedPageRoot`/`viewedSchema` exactly as Design's own read-only branch already does.
  const previewRoot = previewState === 'draft' ? projectedPageRoot : viewedPageRoot;
  const previewThemeTokensResolved =
    previewState === 'draft' ? schemaThemeTokens(schema) : viewedSchema ? schemaThemeTokens(viewedSchema) : undefined;
  const previewBannerText =
    previewState === 'draft'
      ? t('previewState.draftBanner')
      : previewState === 'published'
      ? t('previewState.publishedBanner', { version: publishedVersion?.version ?? 0 })
      : t('previewState.defaultBanner');

  const statusBadge = saving ? (
    <Badge tone="muted" className="shrink-0">{t('savingBadge')}</Badge>
  ) : dirty ? (
    <Badge tone="warning" className="shrink-0">{t('unsavedBadge')}</Badge>
  ) : (
    <Badge tone="positive" className="shrink-0">{t('savedBadge')}</Badge>
  );

  const structurePanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        {((editorMode === 'easy' ? ['pages', 'theme', 'identity'] : ['pages', 'theme']) as StructureMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={structureMode === mode}
            onClick={() => switchStructureMode(mode)}
            className={cn(
              'h-7 flex-1 rounded px-2 text-xs font-medium',
              structureMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
            )}
          >
            {mode === 'pages' ? t('pagesTitle') : mode === 'theme' ? t('theme.tabLabel') : t('easy.identity.tab')}
          </button>
        ))}
      </div>
      {structureMode === 'pages' ? (
        <>
          {editorMode === 'easy' ? (
            // الوضع السهل: الصفحات شرائح مدمجة (اختيار + إضافة) لتبقى المساحة لقائمة الأقسام، خصوصاً على الجوال. تعيين الرئيسية وحذف الصفحة في الوضع المتقدم.
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2" role="group" aria-label={t('pagesTitle')}>
              {pageIds.map((pageId) => (
                <button
                  key={pageId}
                  type="button"
                  onClick={() => selectPage(pageId)}
                  aria-current={pageId === selectedPageId ? 'page' : undefined}
                  className={cn(
                    'h-8 max-w-[9rem] truncate rounded-full border px-3 text-xs font-medium',
                    pageId === selectedPageId ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-background'
                  )}
                >
                  {editorMeta?.pages[pageId]?.title ?? pageId}{pageId === schema.navigation?.initialPageId ? ' ★' : ''}
                </button>
              ))}
              <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-full" aria-label={t('pages.addAction')} title={t('pages.addAction')} disabled={!canManage} onClick={addNewPage}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              </Button>
            </div>
          ) : (
          <div className="shrink-0 space-y-0.5 border-b border-border p-2">
            {pageIds.map((pageId) => {
              const isInitial = pageId === schema.navigation?.initialPageId;
              const canRemove = pageIds.length > 1 && !isInitial;
              return (
                <div key={pageId} className="group flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => selectPage(pageId)}
                    aria-current={pageId === selectedPageId ? 'page' : undefined}
                    className={cn(
                      'flex h-8 min-w-0 flex-1 items-center rounded px-2 text-start text-sm',
                      pageId === selectedPageId ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-background'
                    )}
                  >
                    <span className="truncate">{pageId}</span>
                    {isInitial ? <Badge tone="muted" className="ms-auto shrink-0">{t('initialPageBadge')}</Badge> : null}
                  </button>
                  {!isInitial ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('pages.setHomeLabel')}
                      title={t('pages.setHomeLabel')}
                      disabled={!canManage}
                      onClick={() => makeInitialPage(pageId)}
                      className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <Home className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('pages.removeLabel')}
                    disabled={!canRemove || !canManage}
                    onClick={() => deletePage(pageId)}
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="mt-1 h-8 w-full text-xs" disabled={!canManage} onClick={addNewPage}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('pages.addAction')}
            </Button>
          </div>
          )}
          {editorMode === 'easy' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {selectedPageId ? (
                <EasyPageActions
                  pageId={selectedPageId}
                  pageName={editorMeta?.pages[selectedPageId]?.title ?? selectedPageId}
                  isInitial={selectedPageId === schema.navigation?.initialPageId}
                  canDelete={pageIds.length > 1}
                  canManage={canManage}
                  navigationRefs={countNavigationTo(schema, selectedPageId, registries ? (type) => registries.components[type]?.actionable === true : undefined)}
                  onSetHome={() => makeInitialPage(selectedPageId)}
                  onDelete={() => deletePage(selectedPageId)}
                  t={t}
                />
              ) : null}
              <div className="min-h-0 flex-1">
              <EasySectionsPanel
                // مربوطة بالصفحة: تغيير الصفحة يعيد تركيب اللوحة فيسقط أي حقل تسمية معلّق (وإلا كُتب نصّه على الصفحة الجديدة).
                key={selectedPageId ?? 'none'}
                sections={currentPageRoot?.children ?? []}
                selectedId={selectedComponentId}
                canManage={canManage}
                registries={registries}
                locale={locale}
                t={t}
                onSelect={selectComponent}
                onMove={(id, direction) => selectedPageId && moveNode(selectedPageId, id, direction)}
                onDuplicate={easyDuplicate}
                onDelete={easyDelete}
                onAdd={() => setCatalogOpen(true)}
                onUndo={easyUndoDelete}
                canUndo={canUndo}
                undoBanner={deleteUndo ? { name: deleteUndo.name } : null}
                markers={issueMarkers}
                nodeMeta={nodeMeta}
                onToggleHidden={easyToggleHidden}
                onRename={easyRename}
                pageTitle={(selectedPageId && editorMeta?.pages[selectedPageId]?.title) || selectedPageId || ''}
                pageTitleCustom={(selectedPageId && editorMeta?.pages[selectedPageId]?.title) || ''}
                onRenamePage={easyRenamePage}
                onReorder={(ids) => selectedPageId && reorderSiblings(selectedPageId, currentPageRoot?.id ?? '', ids)}
              />
              </div>
            </div>
          ) : (
          <>
          <div className="shrink-0 px-3 py-2">
            <p className="text-xs font-semibold text-muted">{t('layersTitle')}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            <LayersTree
              root={currentPageRoot}
              selectedId={selectedComponentId}
              onSelect={selectComponent}
              onReorder={(parentId, orderedIds) => selectedPageId && reorderSiblings(selectedPageId, parentId, orderedIds)}
              onMove={(id, direction) => selectedPageId && moveNode(selectedPageId, id, direction)}
              emptyLabel={t('emptyPage')}
              registries={registries}
            />
          </div>
          </>
          )}
        </>
      ) : structureMode === 'identity' ? (
        <EasyIdentityPanel name={app.name} nameEn={app.name_en} canManage={canManage} saving={renaming} onSave={renameApp} t={t} />
      ) : (
        <p className="px-3 py-4 text-xs leading-relaxed text-muted">{t('theme.tabDescription')}</p>
      )}
    </div>
  );

  const inspectorPanel = (
    <fieldset disabled={!canManage} className="contents">
    <div className="h-full min-h-0 overflow-y-auto">
      {structureMode === 'theme' ? (
        <ThemePanel tokens={schemaThemeTokens(schema)} onChange={applyThemeEdit} onPreview={setPreviewThemeTokens} />
      ) : (
        <Inspector
          node={selectedNode}
          registries={registries}
          pageIds={pageIds}
          onChange={updateSelectedNode}
          onAddChild={addChildToSelected}
          onRemove={removeSelected}
          canRemove={Boolean(selectedNode && currentPageRoot && selectedNode.id !== currentPageRoot.id)}
          mode={editorMode}
        />
      )}
    </div>
    </fieldset>
  );

  /**
   * LIVE-PREVIEW-6 — لوحتا القراءة فقط لحالتَي «منشورة»/«افتراضية»: لا زرّ إضافة/حذف/تعيين
   * رئيسية، ولا Inspector — مجرّد تنقّل بين صفحات المخطط المعروض (`viewedPageId` محلّي، لا
   * يمسّ `selectedPageId`/`selectedComponentId` الخاصّين بتحرير المسودة إطلاقاً).
   */
  const readOnlyPagePanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-2">
        <p className="text-xs font-semibold text-muted">{t('pagesTitle')}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {viewedPageIds.map((pageId) => (
          <button
            key={pageId}
            type="button"
            onClick={() => setViewedPageId(pageId)}
            aria-current={pageId === effectiveViewedPageId ? 'page' : undefined}
            className={cn(
              'flex h-8 w-full items-center rounded px-2 text-start text-sm',
              pageId === effectiveViewedPageId ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-background'
            )}
          >
            <span className="truncate">{pageId}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const readOnlyNotice = (
    <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-xs leading-relaxed text-muted">
      {t('previewState.readOnlyNotice')}
    </div>
  );

  const isDraftView = previewState === 'draft';

  /**
   * MOBILE-PREVIEW-4 — dispatches a tapped node's `action` inside App Preview. This mirrors
   * what the shipped runtime's `RuntimeActionHandler` would actually do for the same action —
   * never a silent success, never a generic page router the real app doesn't have — see
   * `resolvePreviewActionOutcome`'s own doc comments (`action-semantics.ts`) for the exact
   * reasoning behind each branch below. Only ever wired to the Preview canvas (`onAction` on
   * `previewCanvasArea`'s `AppBuilderCanvas` below) — Design mode's own canvas calls never pass
   * `onAction`, so tapping a node there still only selects it, exactly as before.
   */
  function handlePreviewAction(action: AppSchemaActionRef) {
    const outcome = resolvePreviewActionOutcome(action);
    switch (outcome.kind) {
      case 'navigate':
        // `isDraftView` reuses the same page-selection state Design mode already relies on
        // (`selectedPageId`/`currentPageRoot`) — MOBILE-PREVIEW-3's own architecture already
        // avoids a second "viewed" tracking variable for Draft; `published`/`default` use the
        // existing `viewedPageId` the read-only page sidebar already sets. If the target page id
        // doesn't exist in the currently viewed schema, the existing `effectiveViewedPageId`/
        // `currentPageRoot` fallbacks already degrade safely (to the schema's own initial page,
        // or to the canvas's own "empty page" state) — never a crash, never a fabricated page.
        if (isDraftView) setSelectedPageId(outcome.pageId);
        else setViewedPageId(outcome.pageId);
        break;
      case 'navigate-unsupported':
        toast.toast({
          title: t('preview.limitation.navigateUnsupportedTitle'),
          description: t('preview.limitation.navigateUnsupportedDescription', { pageId: outcome.pageId }),
          variant: 'warning',
        });
        break;
      case 'requires-live-data':
        toast.toast({ title: t('preview.limitation.requiresLiveDataTitle'), variant: 'warning' });
        break;
      case 'safe-noop':
      case 'inert':
        // Matches the real runtime exactly: `refresh` has no live effect to simulate here (the
        // real handler never touches the network either), and a malformed/unknown action
        // already dispatches nothing on real mobile — silence here is honest, not a gap.
        break;
    }
  }

  /**
   * APP-BUILDER-PREVIEW-UX-1 — identical dispatch to `handlePreviewAction` above (same
   * `resolvePreviewActionOutcome`, same truthful "unsupported"/"requires live data" notices
   * — no second preview semantic model), except a `navigate` outcome moves only the inline
   * Design-mode frame's own `inlinePreviewPageId`, never `selectedPageId`/`viewedPageId`.
   * Tapping "Cart" inside the live phone frame while editing the Home page explores the app
   * without pulling the editor away from what it's actually editing.
   */
  function handleInlinePreviewAction(action: AppSchemaActionRef) {
    const outcome = resolvePreviewActionOutcome(action);
    switch (outcome.kind) {
      case 'navigate':
        setInlinePreviewPageId(outcome.pageId);
        break;
      case 'navigate-unsupported':
        toast.toast({
          title: t('preview.limitation.navigateUnsupportedTitle'),
          description: t('preview.limitation.navigateUnsupportedDescription', { pageId: outcome.pageId }),
          variant: 'warning',
        });
        break;
      case 'requires-live-data':
        toast.toast({ title: t('preview.limitation.requiresLiveDataTitle'), variant: 'warning' });
        break;
      case 'safe-noop':
      case 'inert':
        break;
    }
  }

  /**
   * MOBILE-PREVIEW-3 — the read-only device-frame content shared by normal App Preview and
   * Full Preview: same loading/error/canvas branching Design mode's own read-only branch
   * already has for `published` (lines above), just wrapped in `DeviceFrame` and rendered
   * with `interactive={false}` instead of the desktop-width bordered box.
   */
  const previewCanvasArea =
    previewState === 'published' && publishedLoading ? (
      <div className="text-sm text-muted">{tc('loading')}</div>
    ) : previewState === 'published' && publishedError ? (
      <div className="max-w-xs text-center text-sm text-negative">{publishedError}</div>
    ) : (
      <DeviceFrame key={previewRefreshKey} preset={previewDevicePreset}>
        <AppBuilderCanvas
          root={previewRoot}
          device="mobile"
          locale={previewLocale}
          selectedId={null}
          onSelect={() => {}}
          themeTokens={previewThemeTokensResolved}
          registries={registries}
          stateBanner={previewBannerText}
          interactive={false}
          onAction={handlePreviewAction}
        />
      </DeviceFrame>
    );

  const previewTruthBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted">
      {t('preview.browserTruthBadge')}
    </span>
  );

  /**
   * APP-BUILDER-PREVIEW-UX-1 — the two required, clearly-separated preview toolbar actions
   * (decision §4): "Refresh Preview" re-syncs this browser device frame; "Preview on Phone"
   * (`PreviewOnPhoneButton`, MOBILE-PREVIEW-7's own QR flow, untouched) opens the real
   * Flutter runtime on a device. Shared between the inline Design-mode frame and the full
   * App Preview toolbar below — never shown in the same toolbar as each other's meaning.
   */
  const refreshPreviewButton = (
    <Button type="button" variant="outline" size="sm" disabled={refreshingPreview} onClick={() => void refreshPreview()}>
      <RefreshCcw className={cn('h-3.5 w-3.5', refreshingPreview && 'animate-spin')} strokeWidth={1.7} aria-hidden="true" />
      {refreshingPreview ? t('preview.refreshing') : t('preview.refreshAction')}
    </Button>
  );
  const previewOnPhoneButton = <PreviewOnPhoneButton appId={app.id} />;

  /** AD-01 / S01b — حوارات سلامة الحفظ، تُعرض في كل أوضاع الصفحة. */
  const safetyDialogs = (
    <>
      <DraftConflictDialog
        state={conflict}
        locale={locale}
        onKeepEditing={() => setConflict(null)}
        onCopy={() => void copyMyChanges()}
        onAskReload={() => setConflict((c) => (c ? { ...c, stage: 'confirmReload' } : c))}
        onConfirmReload={confirmReloadLatest}
        onAskOverwrite={() => void startOverwrite()}
        onConfirmOverwrite={() => void confirmOverwrite()}
        onBack={() => setConflict((c) => (c ? { ...c, stage: 'choose', latest: null, changedAgain: false } : c))}
      />
      <LeaveGuardDialog open={leaveGuard.pending !== null} onStay={leaveGuard.cancelLeave} onLeave={() => { flushBackupNow(); leaveGuard.confirmLeave(); }} />
      <RecoverBackupDialog backup={recovery} locale={locale} onRestore={restoreLocalBackup} onDiscard={discardLocalBackup} />
    </>
  );

  /** يحدّد مكوّناً بمعرّفه (أول صفحة تحويه) كما يفعل `openIssue`: يعيد وضع التصميم/المسودة ويغلق حوار النشر ويعيد لوحة الصفحات (لا تبقى لوحة المظهر أو App Preview تخفي المفتش). */
  function openComponentById(componentId: string, preferredPageId?: string | null) {
    if (!schema) return;
    // معرّف المكوّن فريد داخل الصفحة وحدها: الصفحة التي أبلغ عنها التقرير تتقدّم، وإلا أول صفحة تحويه (خادم أقدم بلا page_id).
    const pageId = preferredPageId && schema.pages[preferredPageId] && findComponentById(schema.pages[preferredPageId], componentId) !== null
      ? preferredPageId
      : Object.keys(schema.pages).find((id) => findComponentById(schema.pages[id], componentId) !== null);
    if (!pageId) return;
    setBuilderMode('design');
    setPreviewState('draft');
    setPublishOpen(false);
    selectPage(pageId); // يبدّل لوحة البنية إلى «الصفحات» ويحدّد جذر الصفحة
    setSelectedComponentId(componentId);
  }

  /** يفتح عقدة مشكلة في المحرر: الصفحة ثم العقدة (إن وُجدت)، ويعود إلى التصميم/المسودة ويغلق حوار النشر. */
  function openIssue(issue: ContractIssue) {
    if (!schema || !schema.pages[issue.page_id]) return;
    setBuilderMode('design');
    setPreviewState('draft');
    setPublishOpen(false);
    selectPage(issue.page_id);
    if (issue.node_id && findComponentById(schema.pages[issue.page_id], issue.node_id)) setSelectedComponentId(issue.node_id);
  }

  // القسم الحاوي للعنصر المحدد (الوضع السهل): أول ابن مباشر لجذر الصفحة يحتويه؛ يقود شريط التحديد.
  const selectedSectionInfo = (() => {
    const list = currentPageRoot?.children ?? [];
    const index = list.findIndex((section) => sectionContains(section, selectedComponentId));
    if (index < 0) return null;
    const section = list[index];
    const summary = sectionSummary(section);
    const definition = registries?.components[summary.primaryType];
    return { id: section.id, index, count: list.length, name: nodeMeta[section.id]?.name ?? summary.title ?? (definition ? registryLabel(definition.label, locale) : summary.primaryType) };
  })();

  const notices = (
    <>
      {!canManage ? (
        <p role="status" className="shrink-0 border-b border-border bg-primary-soft px-4 py-2 text-xs text-text">{t('readOnly.notice')}</p>
      ) : null}
      <ContractIssuesNotice issues={contractIssues} t={t} onOpen={openIssue} />
      <CompatNotice report={compat} t={t} onOpen={openComponentById} />
      {saveFailure ? (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-negative/30 bg-negative/10 px-4 py-2 text-xs text-text">
          <span>{saveFailure === 'network' ? t('saveFailure.network') : t('saveFailure.other')}</span>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void handleSave()}>{t('saveFailure.retry')}</Button>
        </div>
      ) : null}
    </>
  );

  if (builderMode === 'preview' && fullPreview) {
    return (
      <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
          {previewTruthBadge}
          <Button type="button" variant="outline" size="sm" onClick={() => setFullPreview(false)}>
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('preview.exitFullPreviewAction')}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-auto p-0 lg:items-center lg:p-6">{previewCanvasArea}</div>
        {safetyDialogs}
      </div>
    );
  }

  return (
    <IssueMarkersProvider markers={issueMarkers}>
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'} data-touch-targets className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 md:px-4 [@media(max-height:500px)]:min-h-11 [@media(max-height:500px)]:flex-nowrap [@media(max-height:500px)]:overflow-x-auto">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={`/app-builder/${app.id}`}>
            {/* UX-07: «رجوع» يتجه حسب اتجاه الصفحة (يمين في RTL، يسار في LTR). */}
            {locale === 'ar' ? <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href="/commerce">{t('backToCommerce')}</Link>
        </Button>
        <p className="min-w-0 truncate text-sm font-semibold text-text">{appDisplayName(app, previewLocale)}</p>
        {statusBadge}

        {/* V2 — الوضع السهل/المتقدم: يبدّل العرض فقط؛ المسودة واحدة ولا شيء يُمسح عند التبديل. */}
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-1" role="group" aria-label={t('easy.modeLabel')}>
          {(['easy', 'advanced'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={editorMode === mode}
              onClick={() => setEditorMode(mode)}
              className={cn(
                'h-7 rounded px-2.5 text-xs font-medium',
                editorMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
              )}
            >
              {t(`easy.mode.${mode}`)}
            </button>
          ))}
        </div>

        {/* MOBILE-PREVIEW-3 — top-level Design / App Preview switch. Deliberately not
            `hidden ... sm:flex` like the other toggle groups below: this is the primary
            mode switch the Horizon calls for, not a secondary control. */}
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-1">
          {(['design', 'preview'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={builderMode === mode}
              onClick={() => setBuilderMode(mode)}
              className={cn(
                'h-7 rounded px-2.5 text-xs font-medium',
                builderMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
              )}
            >
              {t(`builderMode.${mode}`)}
            </button>
          ))}
        </div>

        {builderMode === 'design' ? (
          <>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="icon" aria-label={t('undoLabel')} disabled={!isDraftView || !canManage || !canUndo} onClick={undo}>
                <Undo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('redoLabel')} disabled={!isDraftView || !canManage || !canRedo} onClick={redo}>
                <Redo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </Button>
            </div>
            <Button size="sm" disabled={!isDraftView || !canManage || !dirty || saving} title={!canManage ? t('readOnly.saveForbidden') : undefined} onClick={handleSave}>
              {saving ? t('savingBadge') : tc('save')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!isDraftView || dirty || saving || !canPublish}
              title={!isDraftView ? t('previewState.switchToDraftToPublish') : !canPublish ? t('publish.forbidden') : dirty ? t('publish.saveFirst') : undefined}
              onClick={openPublishDialog}
            >
              <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('publish.action')}
            </Button>
          </>
        ) : null}

        <div className="ms-auto flex flex-wrap items-center gap-2 [@media(max-height:500px)]:flex-nowrap">
          <div className="hidden items-center gap-1 rounded-md border border-border p-1 sm:flex">
            {(['draft', 'published', 'default'] as const).map((state) => {
              const disabled = state === 'published' && !app.latest_published_version;
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={previewState === state}
                  disabled={disabled}
                  title={disabled ? t('previewState.noPublishedVersion') : undefined}
                  onClick={() => switchPreviewState(state)}
                  className={cn(
                    'h-7 rounded px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40',
                    previewState === state ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
                  )}
                >
                  {t(`previewState.${state}`)}
                </button>
              );
            })}
          </div>
          <div className="hidden items-center gap-1 rounded-md border border-border p-1 sm:flex">
            {(['ar', 'en'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={previewLocale === item}
                onClick={() => setPreviewLocale(item)}
                className={cn(
                  'h-7 rounded px-2 text-xs font-medium',
                  previewLocale === item ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
                )}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          {builderMode === 'design' ? (
            <div className="hidden items-center gap-1 rounded-md border border-border p-1 md:flex">
              {(Object.keys(PREVIEW_WIDTHS) as PreviewDevice[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={device === item}
                  onClick={() => setDevice(item)}
                  className={cn(
                    'h-7 rounded px-2.5 text-xs font-medium',
                    device === item ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
                  )}
                >
                  {t(`device.${item}`)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      {notices}

      {builderMode === 'preview' ? (
        // MOBILE-PREVIEW-3 — App Preview shell: no structure/inspector asides, no
        // edit/undo/redo/save/publish controls (already hidden above), no selection —
        // just the device-frame-wrapped, non-interactive canvas plus its own small toolbar.
        <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-surface p-3">
            <div className="flex items-center gap-1 rounded-md border border-border p-1">
              {(Object.keys(DEVICE_FRAME_PRESETS) as DeviceFramePreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={previewDevicePreset === preset}
                  onClick={() => setPreviewDevicePreset(preset)}
                  className={cn(
                    'h-7 rounded px-2.5 text-xs font-medium',
                    previewDevicePreset === preset ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
                  )}
                >
                  {DEVICE_FRAME_PRESETS[preset].label}
                </button>
              ))}
            </div>
            {refreshPreviewButton}
            {previewOnPhoneButton}
            {previewTruthBadge}
            <Button type="button" variant="outline" size="sm" onClick={() => setFullPreview(true)}>
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('preview.fullPreviewAction')}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-auto p-0 lg:items-center lg:p-6">{previewCanvasArea}</div>
        </div>
      ) : (
      /* Desktop/tablet: three fixed panes. Below `lg`: canvas + a switchable structure/inspector pane, per the responsive admin baseline in APP-BUILDER-5-UX-EVIDENCE-PASS.md. */
      <div className="flex min-h-0 flex-1 flex-col min-[744px]:flex-row [@media(max-height:500px)]:flex-row">
        <aside className="hidden w-60 shrink-0 overflow-hidden border-e border-border bg-surface lg:block">
          {isDraftView ? structurePanel : readOnlyPagePanel}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isDraftView && editorMode === 'easy' && selectedSectionInfo ? (
            <EasySelectionBar
              name={selectedSectionInfo.name}
              position={{ index: selectedSectionInfo.index, count: selectedSectionInfo.count }}
              canManage={canManage}
              hidden={nodeMeta[selectedSectionInfo.id]?.hidden === true}
              onToggleHidden={() => easyToggleHidden(selectedSectionInfo.id)}
              onMoveUp={() => selectedPageId && moveNode(selectedPageId, selectedSectionInfo.id, 'up')}
              onMoveDown={() => selectedPageId && moveNode(selectedPageId, selectedSectionInfo.id, 'down')}
              onDuplicate={() => easyDuplicate(selectedSectionInfo.id)}
              onDelete={() => easyDelete(selectedSectionInfo.id, selectedSectionInfo.name)}
              t={t}
            />
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1">
          {isDraftView ? (
            <AppBuilderCanvas
              root={projectedPageRoot}
              device={device}
              locale={previewLocale}
              selectedId={selectedComponentId}
              onSelect={selectComponent}
              themeTokens={previewThemeTokens ?? schemaThemeTokens(schema)}
              registries={registries}
              stateBanner={t('previewState.draftBanner')}
            />
          ) : previewState === 'published' && publishedLoading ? (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted">{tc('loading')}</div>
          ) : previewState === 'published' && publishedError ? (
            <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background p-6 text-center text-sm text-negative">
              {publishedError}
            </div>
          ) : (
            <AppBuilderCanvas
              root={viewedPageRoot}
              device={device}
              locale={previewLocale}
              selectedId={null}
              onSelect={() => {}}
              themeTokens={viewedSchema ? schemaThemeTokens(viewedSchema) : undefined}
              registries={registries}
              stateBanner={
                previewState === 'published'
                  ? t('previewState.publishedBanner', { version: publishedVersion?.version ?? 0 })
                  : t('previewState.defaultBanner')
              }
            />
          )}
          </div>
        </div>

        <aside className="hidden w-72 shrink-0 overflow-hidden border-s border-border bg-surface lg:block">
          {isDraftView ? inspectorPanel : readOnlyNotice}
        </aside>

        {/* APP-BUILDER-PREVIEW-UX-1 — Design mode's own side-by-side mobile frame (UX decision
            §2). Mounted only on a real wide viewport (`isWideBuilderViewport`, a JS
            `matchMedia` check — see its declaration above for why this can't be CSS-only) and
            only while editing the Draft; `published`/`default` keep their existing dedicated
            read-only page browser instead of a second preview surface. */}
        {isDraftView && isWideBuilderViewport && !showInlinePreview ? (
          <div className="flex shrink-0 items-start border-s border-border bg-surface p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('preview.showInlineAction')}
              title={t('preview.showInlineAction')}
              onClick={() => setShowInlinePreview(true)}
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {isDraftView && isWideBuilderViewport && showInlinePreview ? (
          <aside
            data-testid="inline-mobile-preview"
            className="flex w-[420px] shrink-0 flex-col overflow-hidden border-s border-border bg-background"
          >
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface px-2 py-1.5">
              <span className="truncate text-[11px] font-semibold text-muted">{t('preview.inlineTitle')}</span>
              <div className="ms-auto flex items-center gap-1">
                {refreshPreviewButton}
                {previewOnPhoneButton}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('preview.hideInlineAction')}
                  title={t('preview.hideInlineAction')}
                  onClick={() => setShowInlinePreview(false)}
                >
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background p-3">
              <DeviceFrame key={previewRefreshKey} preset={previewDevicePreset}>
                <AppBuilderCanvas
                  root={inlinePreviewRoot}
                  device="mobile"
                  locale={previewLocale}
                  selectedId={null}
                  onSelect={() => {}}
                  themeTokens={schemaThemeTokens(schema)}
                  registries={registries}
                  stateBanner={t('previewState.draftBanner')}
                  interactive={false}
                  onAction={handleInlinePreviewAction}
                />
              </DeviceFrame>
            </div>
            <div className="flex shrink-0 justify-center border-t border-border bg-surface p-1.5">{previewTruthBadge}</div>
          </aside>
        ) : null}

        {/* UX-09/10: الجوال العمودي = ورقة سفلية 38vh؛ من 744px عرضاً (آيباد عمودي) أو في الجوال الأفقي القصير = عمود جانبي بجوار المعاينة بدل حجبها. */}
        <div className="flex h-[38vh] min-h-0 shrink-0 flex-col border-t border-border bg-surface lg:hidden min-[744px]:h-auto min-[744px]:w-80 min-[744px]:border-s min-[744px]:border-t-0 [@media(max-height:500px)]:h-auto [@media(max-height:500px)]:w-80 [@media(max-height:500px)]:border-s [@media(max-height:500px)]:border-t-0">
          {isDraftView ? (
            <>
              <div className="flex shrink-0 border-b border-border">
                <button
                  type="button"
                  onClick={() => setMobilePanel('structure')}
                  aria-current={mobilePanel === 'structure' ? 'page' : undefined}
                  className={cn(
                    'flex h-10 flex-1 items-center justify-center gap-1.5 text-xs font-medium',
                    mobilePanel === 'structure' ? 'border-b-2 border-primary text-primary' : 'text-muted'
                  )}
                >
                  <LayoutPanelLeft className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {t('mobileStructureTab')}
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePanel('inspector')}
                  aria-current={mobilePanel === 'inspector' ? 'page' : undefined}
                  className={cn(
                    'flex h-10 flex-1 items-center justify-center gap-1.5 text-xs font-medium',
                    mobilePanel === 'inspector' ? 'border-b-2 border-primary text-primary' : 'text-muted'
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {t('mobileInspectorTab')}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mobilePanel === 'structure' ? structurePanel : inspectorPanel}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">{readOnlyPagePanel}</div>
          )}
        </div>
      </div>
      )}

      <Dialog open={publishOpen} onClose={() => (publishing ? null : setPublishOpen(false))} title={t('publish.dialogTitle')}>
        <div className="space-y-3">
          {validation.status === 'checking' ? (
            <p className="text-sm text-muted">{t('publish.validating')}</p>
          ) : validation.status === 'passed' ? (
            <div className="space-y-2">
              <p className="text-sm text-positive">{t('publish.validationPassed')}</p>
              {compatNeedsAttention(validation.compat) ? <CompatDisclosure report={validation.compat} t={t} onOpen={openComponentById} /> : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-negative">{validation.message}</p>
              {validation.issues ? <ContractIssuesList issues={validation.issues} t={t} onOpen={openIssue} /> : null}
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text">{t('publish.noteLabel')}</label>
            <Textarea
              className="min-h-20 text-sm"
              value={publishNote}
              onChange={(event) => setPublishNote(event.target.value)}
              placeholder={t('publish.notePlaceholder')}
              disabled={publishing}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={publishing} onClick={() => setPublishOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button type="button" disabled={publishing || validation.status !== 'passed'} onClick={confirmPublish}>
              {publishing ? t('publish.publishing') : t('publish.confirmAction')}
            </Button>
          </div>
        </div>
      </Dialog>
      <EasyCatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} onPick={easyAdd} pageId={selectedPageId} t={t} />
      {safetyDialogs}
    </div>
    </IssueMarkersProvider>
  );
}
