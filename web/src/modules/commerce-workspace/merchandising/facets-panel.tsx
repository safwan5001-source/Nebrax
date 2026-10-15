'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { cn } from '@/lib/utils';
import { FacetVisualTile, type FacetVisualTileImage } from '@/modules/store-experience-builder/FacetVisualTile';
import {
  type FacetVisual,
  resolveFacetSelfVisual,
  resolveFacetValueVisual,
  type ResolvedFacetVisual,
} from '@/modules/store-experience-builder/presentation/facet-visual';
import { FACET_SHAPE_GEOMETRY } from '@/modules/store-experience-builder/presentation/facet-visual-style';
import {
  createFacet,
  createFacetValue,
  deleteFacet,
  deleteFacetValue,
  loadFacets,
  suggestFacetKey,
  updateFacet,
  updateFacetValue,
  type Facet,
  type FacetValue,
  type SystemFacetKey,
} from './client';
import { ConfirmDialog, FieldsDialog, writeFailureMessage, type T } from './common';
import type { EditorTab } from './visual-editor/document';
import { FacetVisualEditor } from './visual-editor/FacetVisualEditor';
import { createVisualEditorT, type VT } from './visual-editor/messages';
import type { EditorTarget } from './visual-editor/types';
import { previewImage } from './visual-editor/use-image-source';

type PanelDialog =
  | { kind: 'create-facet'; preset?: SystemFacetKey }
  | { kind: 'editor'; facetId: string; valueId?: string; tab: EditorTab; nonce: number }
  | { kind: 'created'; facetId: string; valueId?: string; name: string }
  | { kind: 'delete-facet'; facet: Facet }
  | { kind: 'add-value'; facet: Facet }
  | { kind: 'delete-value'; facet: Facet; value: FacetValue };

const COLLAPSED_KEY = 'awj.merch.facets.collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage may be blocked: the choice then lasts for this visit only.
  }
}

/**
 * The 32 px identity thumbnail of a list row (UX requirements §3.1): the real `FacetVisualTile`, shown **only** when
 * the resolved identity draws something. A row with no identity gets no grey placeholder. The row already prints the
 * name, so the tile's own label is visually hidden and the whole thumbnail is decorative.
 */
function Thumbnail({ visual, label, image }: { visual: ResolvedFacetVisual; label: string; image: FacetVisualTileImage | null }) {
  if (visual.content === 'none') return null;
  const tall = FACET_SHAPE_GEOMETRY[visual.shape]?.aspect === '3 / 4';
  return (
    <span
      aria-hidden="true"
      data-row-thumb=""
      className="flex h-8 w-8 shrink-0 items-center justify-center [&>span]:w-full [&>span>span:last-child]:sr-only"
    >
      <span className={cn('block', tall ? 'w-6' : 'w-8')}>
        <FacetVisualTile visual={{ ...visual, showLabel: false }} label={label} image={image} className="w-full" />
      </span>
    </span>
  );
}

/** تبويب «الأبعاد»: بُعد → قيم، مع تعطيل بدل حذف حين تُسنَد القيمة (ADR-14 §2.1). */
export function FacetsPanel({
  t,
  locale = 'ar',
  canManage,
  canManageIdentity = false,
}: {
  t: T;
  locale?: 'ar' | 'en';
  /** `products.manage`. */
  canManage: boolean;
  /** `commerce.manage` — the server's guard for the visual identity (D-04). */
  canManageIdentity?: boolean;
}) {
  const { success } = useToast();
  const vt: VT = useMemo(() => createVisualEditorT(locale), [locale]);
  const [facets, setFacets] = useState<Facet[] | null | 'error'>(null);
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [revealedBlock, setRevealedBlock] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadFacets();
    setFacets(result ?? 'error');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Remembered per browser; read after mount so the server render and first paint agree.
  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  const toggleCollapsed = (facetId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(facetId)) next.delete(facetId);
      else next.add(facetId);
      writeCollapsed(next);
      return next;
    });
  };

  // تبديلٌ واحد في الطيران: كل المفاتيح تُعطَّل ريثما يكتمل الكتابة وإعادة التحميل، فلا يتسابق
  // تحميلان ولا تُمسح علامة الانشغال مبكراً.
  const toggleFacet = async (facet: Facet) => {
    if (busyId !== null) return;
    setBusyId(facet.id);
    setToggleError(null);
    const result = await updateFacet(facet.id, { isActive: !facet.isActive });
    if (!result.ok) setToggleError(writeFailureMessage(result, t));
    await load();
    setBusyId(null);
  };

  const toggleValue = async (facet: Facet, value: FacetValue) => {
    if (busyId !== null) return;
    setBusyId(value.id);
    setToggleError(null);
    const result = await updateFacetValue(facet.id, value.id, { isActive: !value.isActive });
    if (!result.ok) setToggleError(writeFailureMessage(result, t));
    await load();
    setBusyId(null);
  };

  const finish = async (message?: string, created?: { facetId: string; valueId?: string; name: string }) => {
    // «Customize appearance» is offered only to a role that can actually write an identity.
    setDialog(created && canManageIdentity ? { kind: 'created', ...created } : null);
    await load();
    if (message) success(message);
  };

  const openEditor = (facetId: string, valueId?: string, tab: EditorTab = 'data') =>
    setDialog({ kind: 'editor', facetId, valueId, tab, nonce: Date.now() });

  const editorTarget = useMemo<EditorTarget | null>(() => {
    if (dialog?.kind !== 'editor' || !Array.isArray(facets)) return null;
    const facet = facets.find((f) => f.id === dialog.facetId);
    if (!facet) return null;
    if (!dialog.valueId) return { kind: 'facet', facet };
    const value = facet.values.find((v) => v.id === dialog.valueId);
    return value ? { kind: 'value', facet, value } : null;
  }, [dialog, facets]);

  if (facets === null) return <LoadingState variant="cards" rows={2} label={t('merchLoading')} />;
  if (facets === 'error') return <ErrorState message={t('merchLoadFailed')} onRetry={() => void load()} />;

  const hasSystem = (key: SystemFacetKey) => facets.some((f) => f.systemKey === key);
  const displayName = (name: string, nameEn: string | null) => (locale === 'en' && nameEn ? nameEn : name);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t('merchFacetsIntro')}</p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {!hasSystem('occasion') ? (
              <Button type="button" disabled={busyId !== null} variant="outline" size="sm" onClick={() => setDialog({ kind: 'create-facet', preset: 'occasion' })}>
                {t('merchPresetOccasion')}
              </Button>
            ) : null}
            {!hasSystem('recipient') ? (
              <Button type="button" disabled={busyId !== null} variant="outline" size="sm" onClick={() => setDialog({ kind: 'create-facet', preset: 'recipient' })}>
                {t('merchPresetRecipient')}
              </Button>
            ) : null}
            <Button type="button" disabled={busyId !== null} size="sm" onClick={() => setDialog({ kind: 'create-facet' })}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('merchFacetCreate')}
            </Button>
          </div>
        ) : null}
      </div>

      {toggleError ? (
        <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{toggleError}</p>
      ) : null}

      {facets.length === 0 ? (
        <EmptyState icon={Layers} title={t('merchFacetsEmptyTitle')} description={t('merchFacetsEmptyDescription')} />
      ) : (
        <ul className="space-y-3">
          {facets.map((facet) => {
            const facetBlocked = facet.values.some((v) => v.productCount > 0);
            const isCollapsed = collapsed.has(facet.id);
            const facetVisual = resolveFacetSelfVisual(facet.visual ?? {}).visual;
            return (
              <li key={facet.id} className="rounded border border-border bg-surface" data-facet-row={facet.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 md:hidden"
                      aria-expanded={!isCollapsed}
                      aria-controls={`values-${facet.id}`}
                      aria-label={`${isCollapsed ? vt('expandValues') : vt('collapseValues')} — ${displayName(facet.name, facet.nameEn)}`}
                      onClick={() => toggleCollapsed(facet.id)}
                    >
                      {isCollapsed ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                    <Thumbnail visual={facetVisual} label={facet.name} image={previewImage(facet.visualPreview)} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="min-w-0 break-words text-sm font-semibold text-text">{facet.name}</h3>
                        {facet.nameEn ? <span className="text-xs text-muted" dir="ltr">{facet.nameEn}</span> : null}
                        <code className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-muted" dir="ltr">{facet.key}</code>
                        {facet.systemKey ? <Badge tone="neutral">{t('merchCoreBadge')}</Badge> : null}
                        {!facet.isActive ? <Badge tone="muted">{t('merchInactive')}</Badge> : null}
                      </div>
                      {canManage && facetBlocked ? (
                        <p
                          id={`blocked-${facet.id}`}
                          data-delete-blocked={facet.id}
                          className={cn('text-xs text-muted', revealedBlock !== facet.id && 'md:hidden')}
                        >
                          {t('merchDeleteBlocked')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManage ? (
                      <Switch
                        checked={facet.isActive}
                        disabled={busyId !== null}
                        onCheckedChange={() => void toggleFacet(facet)}
                        aria-label={`${facet.isActive ? t('merchDisable') : t('merchEnable')} ${facet.name}`}
                      />
                    ) : null}
                    <Button
                      type="button"
                      disabled={busyId !== null}
                      variant="ghost"
                      size="icon"
                      className="max-md:size-11"
                      aria-label={`${canManage ? t('merchEdit') : vt('viewAction')} ${facet.name}`}
                      onClick={() => openEditor(facet.id)}
                    >
                      {canManage ? <Pencil className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn('max-md:size-11', facetBlocked && 'opacity-50')}
                        aria-label={`${t('merchDelete')} ${facet.name}`}
                        aria-disabled={facetBlocked || undefined}
                        aria-describedby={facetBlocked ? `blocked-${facet.id}` : undefined}
                        disabled={busyId !== null}
                        title={facetBlocked ? t('merchDeleteBlocked') : undefined}
                        onClick={() =>
                          facetBlocked
                            ? setRevealedBlock((current) => (current === facet.id ? null : facet.id))
                            : setDialog({ kind: 'delete-facet', facet })
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div id={`values-${facet.id}`} className={cn(isCollapsed && 'max-md:hidden')}>
                  <ul className="divide-y divide-border">
                    {facet.values.map((value) => {
                      const blocked = value.productCount > 0;
                      const resolved = resolveFacetValueVisual(facet.visual ?? {}, value.visual ?? {}).visual;
                      return (
                        <li key={value.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2" data-value-row={value.id}>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Thumbnail visual={resolved} label={value.name} image={previewImage(value.visualPreview)} />
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className={cn('min-w-0 break-words text-sm', value.isActive ? 'text-text' : 'text-muted line-through')}>{value.name}</span>
                                {value.nameEn ? <span className="text-xs text-muted" dir="ltr">{value.nameEn}</span> : null}
                                <span className="text-xs text-muted">
                                  {value.productCount} {t('merchProductsSuffix')}
                                </span>
                              </div>
                              {canManage && blocked ? (
                                <p
                                  id={`blocked-${value.id}`}
                                  data-delete-blocked={value.id}
                                  className={cn('text-xs text-muted', revealedBlock !== value.id && 'md:hidden')}
                                >
                                  {t('merchDeleteBlocked')}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {canManage ? (
                              <Switch
                                checked={value.isActive}
                                disabled={busyId !== null}
                                onCheckedChange={() => void toggleValue(facet, value)}
                                aria-label={`${value.isActive ? t('merchDisable') : t('merchEnable')} ${value.name}`}
                              />
                            ) : null}
                            <Button
                              type="button"
                              disabled={busyId !== null}
                              variant="ghost"
                              size="icon"
                              className="max-md:size-11"
                              aria-label={`${canManage ? t('merchEdit') : vt('viewAction')} ${value.name}`}
                              onClick={() => openEditor(facet.id, value.id)}
                            >
                              {canManage ? <Pencil className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                            </Button>
                            {canManage ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={busyId !== null}
                                className={cn('max-md:size-11', blocked && 'opacity-50')}
                                title={blocked ? t('merchDeleteBlocked') : undefined}
                                aria-label={`${t('merchDelete')} ${value.name}`}
                                aria-disabled={blocked || undefined}
                                aria-describedby={blocked ? `blocked-${value.id}` : undefined}
                                onClick={() =>
                                  blocked
                                    ? setRevealedBlock((current) => (current === value.id ? null : value.id))
                                    : setDialog({ kind: 'delete-value', facet, value })
                                }
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {canManage ? (
                    <div className="border-t border-border px-3 py-2">
                      <Button type="button" disabled={busyId !== null} variant="ghost" size="sm" onClick={() => setDialog({ kind: 'add-value', facet })}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> {t('merchValueAdd')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'create-facet' ? (
        <FieldsDialog
          t={t}
          title={t('merchFacetCreate')}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'name', label: vt('nameAr'), required: true, value: dialog.preset === 'occasion' ? t('merchPresetOccasionName') : dialog.preset === 'recipient' ? t('merchPresetRecipientName') : '' },
            { id: 'nameEn', label: vt('nameEn'), dir: 'ltr', value: dialog.preset === 'occasion' ? 'Occasion' : dialog.preset === 'recipient' ? 'Recipient' : '' },
            { id: 'key', label: t('merchFacetKey'), required: true, dir: 'ltr', value: dialog.preset ?? '' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const result = await createFacet({
              key: v.key.trim() || suggestFacetKey(v.nameEn ?? ''),
              name: v.name.trim(),
              nameEn: v.nameEn?.trim() || undefined,
              systemKey: dialog.preset,
            });
            if (!result.ok) return writeFailureMessage(result, t);
            await finish(undefined, result.data ? { facetId: result.data.id, name: result.data.name } : undefined);
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'add-value' ? (
        <FieldsDialog
          t={t}
          title={`${t('merchValueAdd')} — ${dialog.facet.name}`}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'name', label: vt('nameAr'), required: true, value: '' },
            { id: 'nameEn', label: vt('nameEn'), dir: 'ltr', value: '' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const result = await createFacetValue(dialog.facet.id, { name: v.name.trim(), nameEn: v.nameEn?.trim() || undefined });
            if (!result.ok) return writeFailureMessage(result, t);
            await finish(
              undefined,
              result.data ? { facetId: dialog.facet.id, valueId: result.data.id, name: result.data.name } : undefined,
            );
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'created' ? (
        <Dialog open onClose={() => setDialog(null)} title={dialog.valueId ? vt('titleValue') : vt('titleFacet')}>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-text">
              {dialog.valueId ? vt('createdValue', { name: dialog.name }) : vt('createdFacet', { name: dialog.name })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog(null)}>
                {vt('later')}
              </Button>
              <Button type="button" className="min-h-11" onClick={() => openEditor(dialog.facetId, dialog.valueId, 'image')}>
                {vt('customizeAppearance')}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {dialog?.kind === 'editor' && editorTarget ? (
        <FacetVisualEditor
          key={dialog.nonce}
          target={editorTarget}
          locale={locale}
          t={t}
          canManageData={canManage}
          canManageIdentity={canManageIdentity}
          initialTab={dialog.tab}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
            success(vt('saved'));
          }}
          onReload={() => {
            // Fresh data first, then a fresh editor on it: nothing is merged over a version the user has not seen.
            void load().then(() => setDialog((current) => (current?.kind === 'editor' ? { ...current, nonce: Date.now() } : current)));
          }}
        />
      ) : null}

      {dialog?.kind === 'delete-facet' ? (
        <ConfirmDialog
          t={t}
          title={`${t('merchDelete')} — ${dialog.facet.name}`}
          message={dialog.facet.values.some((v) => v.productCount > 0) ? t('merchDeleteBlocked') : t('merchConfirmDeleteFacet')}
          confirmLabel={t('merchDelete')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await deleteFacet(dialog.facet.id);
            if (!result.ok) return writeFailureMessage(result, t);
            await finish();
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'delete-value' ? (
        <ConfirmDialog
          t={t}
          title={`${t('merchDelete')} — ${dialog.value.name}`}
          message={t('merchConfirmDeleteValue')}
          confirmLabel={t('merchDelete')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await deleteFacetValue(dialog.facet.id, dialog.value.id);
            if (!result.ok) return writeFailureMessage(result, t);
            await finish();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}
