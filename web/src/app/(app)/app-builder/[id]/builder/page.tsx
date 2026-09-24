'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, LayoutPanelLeft, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  appDisplayName, findComponentById, type AppBuilderRegistries, type BuilderApp, type BuilderDraftExperience,
} from '@/lib/app-builder';
import { AppBuilderCanvas, PREVIEW_WIDTHS, type PreviewDevice } from '@/modules/app-builder/canvas';
import { LayersTree } from '@/modules/app-builder/layers-tree';
import { Inspector } from '@/modules/app-builder/inspector';

type MobilePanel = 'structure' | 'inspector';

/**
 * APP-BUILDER-5 — هيكل مساحة عمل الـ Builder: صفحات/طبقات/كانفاس/Inspector للقراءة
 * فقط، مع تبديل الجهاز واللغة وحالة الحفظ. التحرير الفعلي APP-BUILDER-6 — انظر
 * `APP-BUILDER-5-UX-EVIDENCE-PASS.md` لتفصيل القرار وما استُبعِد عمداً.
 */
export default function AppBuilderWorkspacePage() {
  const t = useTranslations('appBuilder.builder');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();

  const [app, setApp] = useState<BuilderApp | null>(null);
  const [draft, setDraft] = useState<BuilderDraftExperience | null>(null);
  const [registries, setRegistries] = useState<AppBuilderRegistries | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState<'ar' | 'en'>('ar');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('structure');

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
        setDraft(draftRes.data);
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

  const pageIds = useMemo(() => (draft ? Object.keys(draft.schema.pages) : []), [draft]);
  const currentPageRoot = draft && selectedPageId ? draft.schema.pages[selectedPageId] ?? null : null;
  const selectedNode = currentPageRoot && selectedComponentId ? findComponentById(currentPageRoot, selectedComponentId) : null;

  function selectPage(pageId: string) {
    if (!draft) return;
    setSelectedPageId(pageId);
    setSelectedComponentId(draft.schema.pages[pageId]?.id ?? null);
  }

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;
  if (!app || !draft || !registries) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} retryLabel={tc('retry')} />;

  const structurePanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="text-xs font-semibold text-muted">{t('pagesTitle')}</p>
      </div>
      <div className="shrink-0 space-y-0.5 border-b border-border p-2">
        {pageIds.map((pageId) => (
          <button
            key={pageId}
            type="button"
            onClick={() => selectPage(pageId)}
            aria-current={pageId === selectedPageId ? 'page' : undefined}
            className={cn(
              'flex h-8 w-full items-center rounded px-2 text-start text-sm',
              pageId === selectedPageId ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-background'
            )}
          >
            {pageId}
            {pageId === draft.schema.navigation?.initialPageId ? (
              <Badge tone="muted" className="ms-auto">{t('initialPageBadge')}</Badge>
            ) : null}
          </button>
        ))}
      </div>
      <div className="shrink-0 px-3 py-2">
        <p className="text-xs font-semibold text-muted">{t('layersTitle')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <LayersTree
          root={currentPageRoot}
          selectedId={selectedComponentId}
          onSelect={setSelectedComponentId}
          emptyLabel={t('emptyPage')}
        />
      </div>
    </div>
  );

  const inspectorPanel = (
    <div className="h-full min-h-0 overflow-y-auto">
      <Inspector node={selectedNode} registries={registries} />
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
        <Badge tone="positive" className="shrink-0">{t('savedBadge')}</Badge>

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
          onSelect={setSelectedComponentId}
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
    </div>
  );
}
