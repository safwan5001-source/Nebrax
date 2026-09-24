'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Home, LayoutPanelLeft, Plus, Redo2, SlidersHorizontal, Trash2, Undo2, UploadCloud } from 'lucide-react';
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
  addChildComponent, addPage, appDisplayName, findComponentById, findParentId, generatePageId, hasAppBuilderPermission,
  mergeThemeTokens, moveSibling, removeComponentById, removePage, reorderChildren, setInitialPage,
  themeTokens as schemaThemeTokens, updateComponentById,
  type AppBuilderRegistries, type AppSchema, type AppSchemaComponent, type BuilderApp, type BuilderDraftExperience,
} from '@/lib/app-builder';
import { AppBuilderCanvas, PREVIEW_WIDTHS, type PreviewDevice } from '@/modules/app-builder/canvas';
import { LayersTree } from '@/modules/app-builder/layers-tree';
import { Inspector } from '@/modules/app-builder/inspector';
import { ThemePanel } from '@/modules/app-builder/theme-panel';

type MobilePanel = 'structure' | 'inspector';
type StructureMode = 'pages' | 'theme';
const HISTORY_LIMIT = 50;

/**
 * APP-BUILDER-6 — يبني على هيكل APP-BUILDER-5 (لا تغيير في الشكل/الاستجابة) ويضيف
 * تحرير المخطط فعلياً: تحديد/إضافة/حذف/إعادة ترتيب، خصائص وإجراءات قابلة للتحرير في
 * الـ Inspector، تراجع/إعادة محدودان، وحفظ صريح عبر `PUT /app-builder/apps/{id}/draft`
 * الموجود أصلاً منذ APP-BUILDER-1. انظر `APP-BUILDER-6-UX-EVIDENCE-PASS.md`.
 */
export default function AppBuilderWorkspacePage() {
  const t = useTranslations('appBuilder.builder');
  const tc = useTranslations('common');
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

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState<'ar' | 'en'>('ar');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('structure');
  const [structureMode, setStructureMode] = useState<StructureMode>('pages');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [validation, setValidation] = useState<{ status: 'checking' | 'passed' | 'failed'; message?: string }>({ status: 'checking' });
  const [publishing, setPublishing] = useState(false);
  const canPublish = hasAppBuilderPermission(currentUser(), 'apps_builder.publish');
  const [previewThemeTokens, setPreviewThemeTokens] = useState<Record<string, string> | null>(null);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api<{ data: BuilderApp }>(`/app-builder/apps/${params.id}`),
      api<{ data: BuilderDraftExperience }>(`/app-builder/apps/${params.id}/draft`),
      api<{ data: AppBuilderRegistries }>('/app-builder/registries'),
    ])
      .then(([appRes, draftRes, registriesRes]) => {
        setApp(appRes.data);
        setSchema(draftRes.data.schema);
        pastRef.current = [];
        futureRef.current = [];
        setDirty(false);
        setStructureMode('pages');
        setPreviewThemeTokens(null);
        setRegistries(registriesRes.data);
        const initialPageId = draftRes.data.schema.navigation?.initialPageId ?? null;
        const pageId = initialPageId && draftRes.data.schema.pages[initialPageId] ? initialPageId : Object.keys(draftRes.data.schema.pages)[0] ?? null;
        setSelectedPageId(pageId);
        setSelectedComponentId(pageId ? draftRes.data.schema.pages[pageId].id : null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const applyPageEdit = useCallback(
    (pageId: string, updater: (pageRoot: AppSchemaComponent) => AppSchemaComponent) => {
      if (!schema) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema({ ...schema, pages: { ...schema.pages, [pageId]: updater(schema.pages[pageId]) } });
    },
    [schema]
  );

  const applyThemeEdit = useCallback(
    (patch: Record<string, string>) => {
      if (!schema) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema(mergeThemeTokens(schema, patch));
    },
    [schema]
  );

  /** أساس عمليات صفحات المخطط (إضافة/حذف/تعيين رئيسية) — نفس مسار السجلّ/التعديل. */
  const applyPagesEdit = useCallback(
    (updater: (current: AppSchema) => AppSchema) => {
      if (!schema) return;
      pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setDirty(true);
      setSchema(updater(schema));
    },
    [schema]
  );

  const undo = useCallback(() => {
    if (!schema || pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [schema, ...futureRef.current];
    setDirty(true);
    setSchema(previous);
  }, [schema]);

  const redo = useCallback(() => {
    if (!schema || futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, schema].slice(-HISTORY_LIMIT);
    setDirty(true);
    setSchema(next);
  }, [schema]);

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

  async function handleSave() {
    if (!schema || !params.id) return;
    setSaving(true);
    try {
      await api<{ data: BuilderDraftExperience }>(`/app-builder/apps/${params.id}/draft`, {
        method: 'PUT',
        body: { schema },
      });
      setDirty(false);
      toast.success(t('saveSuccessTitle'));
    } catch (err) {
      toast.error(t('saveErrorTitle'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

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
      await api(`/app-builder/apps/${params.id}/validate`, { method: 'POST' });
      setValidation({ status: 'passed' });
    } catch (err) {
      setValidation({ status: 'failed', message: err instanceof ApiError ? err.message : t('publish.validateErrorGeneric') });
    }
  }

  async function confirmPublish() {
    if (!params.id || validation.status !== 'passed') return;
    setPublishing(true);
    try {
      await api(`/app-builder/apps/${params.id}/versions`, {
        method: 'POST',
        body: { note: publishNote.trim() || undefined },
      });
      setPublishOpen(false);
      toast.success(t('publish.successTitle'));
    } catch (err) {
      toast.error(t('publish.errorTitle'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setPublishing(false);
    }
  }

  const pageIds = useMemo(() => (schema ? Object.keys(schema.pages) : []), [schema]);
  const currentPageRoot = schema && selectedPageId ? schema.pages[selectedPageId] ?? null : null;
  const selectedNode = currentPageRoot && selectedComponentId ? findComponentById(currentPageRoot, selectedComponentId) : null;
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

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
  }

  /** التحديد من الشجرة/الكانفاس يعيد لوحة الفحص دوماً لوضع «الصفحات» — لا يبقى التحديد يتغيّر خلف تبويب المظهر بصمت. */
  function selectComponent(id: string) {
    switchStructureMode('pages');
    setSelectedComponentId(id);
  }

  /** يضيف صفحة فارغة جديدة ويحدّدها مباشرة. */
  function addNewPage() {
    if (!schema) return;
    const pageId = generatePageId();
    applyPagesEdit((current) => addPage(current, pageId));
    setSelectedPageId(pageId);
    setSelectedComponentId(`${pageId}-root`);
  }

  /** يحذف صفحة — لا تأثير على الصفحة الرئيسية أو آخر صفحة متبقية (`removePage` نفسه صامت، والزر معطّل أصلاً في هذه الحالات). إن كانت الصفحة المحذوفة هي المحدَّدة، يعاد التحديد إلى الصفحة الرئيسية الباقية دوماً. */
  function deletePage(pageId: string) {
    if (!schema) return;
    applyPagesEdit((current) => removePage(current, pageId));
    if (selectedPageId === pageId) {
      const fallbackId = schema.navigation.initialPageId;
      setSelectedPageId(fallbackId);
      setSelectedComponentId(schema.pages[fallbackId]?.id ?? null);
    }
  }

  function makeInitialPage(pageId: string) {
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
    if (!selectedPageId || !selectedComponentId || !currentPageRoot || selectedComponentId === currentPageRoot.id) return;
    const targetId = selectedComponentId;
    const parentId = findParentId(currentPageRoot, targetId) ?? currentPageRoot.id;
    applyPageEdit(selectedPageId, (root) => removeComponentById(root, targetId));
    setSelectedComponentId(parentId);
  }

  function reorderSiblings(pageId: string, parentId: string, orderedIds: string[]) {
    applyPageEdit(pageId, (root) => reorderChildren(root, parentId, orderedIds));
  }

  function moveNode(pageId: string, id: string, direction: 'up' | 'down') {
    applyPageEdit(pageId, (root) => moveSibling(root, id, direction));
  }

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;
  if (!app || !schema || !registries) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

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
        {(['pages', 'theme'] as const).map((mode) => (
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
            {mode === 'pages' ? t('pagesTitle') : t('theme.tabLabel')}
          </button>
        ))}
      </div>
      {structureMode === 'pages' ? (
        <>
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
                    disabled={!canRemove}
                    onClick={() => deletePage(pageId)}
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="mt-1 h-8 w-full text-xs" onClick={addNewPage}>
              <Plus className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('pages.addAction')}
            </Button>
          </div>
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
            />
          </div>
        </>
      ) : (
        <p className="px-3 py-4 text-xs leading-relaxed text-muted">{t('theme.tabDescription')}</p>
      )}
    </div>
  );

  const inspectorPanel = (
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
        />
      )}
    </div>
  );

  return (
    // `-m-4 sm:-m-6` cancels `<main>`'s own padding (`(app)/layout.tsx`) so the workspace
    // reaches the page edges like every other full-bleed panel in this shell — a fixed
    // height (not 100vh) because this route stays inside the standard sidebar/topbar
    // layout rather than a chrome-less route group (unlike the Store Customizer's
    // `(commerce)` group); a precise 100vh calc would double-count that chrome.
    <div dir="rtl" className="-m-4 flex h-[80vh] min-h-[560px] flex-col sm:-m-6">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={`/app-builder/${app.id}`}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Link>
        </Button>
        <p className="min-w-0 truncate text-sm font-semibold text-text">{appDisplayName(app, previewLocale)}</p>
        {statusBadge}

        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" aria-label={t('undoLabel')} disabled={!canUndo} onClick={undo}>
            <Undo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('redoLabel')} disabled={!canRedo} onClick={redo}>
            <Redo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>
        </div>
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? t('savingBadge') : tc('save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={dirty || saving || !canPublish}
          title={!canPublish ? t('publish.forbidden') : dirty ? t('publish.saveFirst') : undefined}
          onClick={openPublishDialog}
        >
          <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          {t('publish.action')}
        </Button>

        <div className="ms-auto flex flex-wrap items-center gap-2">
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
        </div>
      </header>

      {/* Desktop/tablet: three fixed panes. Below `lg`: canvas + a switchable structure/inspector pane, per the responsive admin baseline in APP-BUILDER-5-UX-EVIDENCE-PASS.md. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-60 shrink-0 overflow-hidden border-e border-border bg-surface lg:block">
          {structurePanel}
        </aside>

        <AppBuilderCanvas
          root={currentPageRoot}
          device={device}
          locale={previewLocale}
          selectedId={selectedComponentId}
          onSelect={selectComponent}
          themeTokens={previewThemeTokens ?? schemaThemeTokens(schema)}
        />

        <aside className="hidden w-72 shrink-0 overflow-hidden border-s border-border bg-surface lg:block">
          {inspectorPanel}
        </aside>

        <div className="flex min-h-0 shrink-0 flex-col border-t border-border bg-surface lg:hidden" style={{ height: '38vh' }}>
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
        </div>
      </div>

      <Dialog open={publishOpen} onClose={() => (publishing ? null : setPublishOpen(false))} title={t('publish.dialogTitle')}>
        <div className="space-y-3">
          {validation.status === 'checking' ? (
            <p className="text-sm text-muted">{t('publish.validating')}</p>
          ) : validation.status === 'passed' ? (
            <p className="text-sm text-positive">{t('publish.validationPassed')}</p>
          ) : (
            <p className="text-sm text-negative">{validation.message}</p>
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
    </div>
  );
}
