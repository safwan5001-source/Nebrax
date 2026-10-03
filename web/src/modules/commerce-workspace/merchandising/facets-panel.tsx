'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
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

type Dialog =
  | { kind: 'create-facet'; preset?: SystemFacetKey }
  | { kind: 'edit-facet'; facet: Facet }
  | { kind: 'delete-facet'; facet: Facet }
  | { kind: 'add-value'; facet: Facet }
  | { kind: 'edit-value'; facet: Facet; value: FacetValue }
  | { kind: 'delete-value'; facet: Facet; value: FacetValue };

/** تبويب «الأبعاد»: بُعد → قيم، مع تعطيل بدل حذف حين تُسنَد القيمة (ADR-14 §2.1). */
export function FacetsPanel({ t, canManage }: { t: T; canManage: boolean }) {
  const { success } = useToast();
  const [facets, setFacets] = useState<Facet[] | null | 'error'>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadFacets();
    setFacets(result ?? 'error');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const finish = async (message?: string) => {
    setDialog(null);
    await load();
    if (message) success(message);
  };

  if (facets === null) return <LoadingState variant="cards" rows={2} label={t('merchLoading')} />;
  if (facets === 'error') return <ErrorState message={t('merchLoadFailed')} onRetry={() => void load()} />;

  const hasSystem = (key: SystemFacetKey) => facets.some((f) => f.systemKey === key);

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
          {facets.map((facet) => (
            <li key={facet.id} className="rounded border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-text">{facet.name}</h3>
                  {facet.nameEn ? <span className="text-xs text-muted" dir="ltr">{facet.nameEn}</span> : null}
                  <code className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-muted" dir="ltr">{facet.key}</code>
                  {facet.systemKey ? <Badge tone="neutral">{t('merchCoreBadge')}</Badge> : null}
                  {!facet.isActive ? <Badge tone="muted">{t('merchInactive')}</Badge> : null}
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={facet.isActive}
                      disabled={busyId !== null}
                      onCheckedChange={() => void toggleFacet(facet)}
                      aria-label={`${facet.isActive ? t('merchDisable') : t('merchEnable')} ${facet.name}`}
                    />
                    <Button type="button" disabled={busyId !== null} variant="ghost" size="icon" aria-label={`${t('merchEdit')} ${facet.name}`} onClick={() => setDialog({ kind: 'edit-facet', facet })}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('merchDelete')} ${facet.name}`}
                      disabled={busyId !== null || facet.values.some((v) => v.productCount > 0)}
                      title={facet.values.some((v) => v.productCount > 0) ? t('merchDeleteBlocked') : undefined}
                      onClick={() => setDialog({ kind: 'delete-facet', facet })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <ul className="divide-y divide-border">
                {facet.values.map((value) => (
                  <li key={value.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={value.isActive ? 'text-sm text-text' : 'text-sm text-muted line-through'}>{value.name}</span>
                      {value.nameEn ? <span className="text-xs text-muted" dir="ltr">{value.nameEn}</span> : null}
                      <span className="text-xs text-muted">
                        {value.productCount} {t('merchProductsSuffix')}
                      </span>
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={value.isActive}
                          disabled={busyId !== null}
                          onCheckedChange={() => void toggleValue(facet, value)}
                          aria-label={`${value.isActive ? t('merchDisable') : t('merchEnable')} ${value.name}`}
                        />
                        <Button type="button" disabled={busyId !== null} variant="ghost" size="icon" aria-label={`${t('merchEdit')} ${value.name}`} onClick={() => setDialog({ kind: 'edit-value', facet, value })}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busyId !== null || value.productCount > 0}
                          title={value.productCount > 0 ? t('merchDeleteBlocked') : undefined}
                          aria-label={`${t('merchDelete')} ${value.name}`}
                          onClick={() => setDialog({ kind: 'delete-value', facet, value })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>

              {canManage ? (
                <div className="border-t border-border px-3 py-2">
                  <Button type="button" disabled={busyId !== null} variant="ghost" size="sm" onClick={() => setDialog({ kind: 'add-value', facet })}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> {t('merchValueAdd')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'create-facet' ? (
        <FieldsDialog
          t={t}
          title={t('merchFacetCreate')}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'name', label: t('merchFacetName'), required: true, value: dialog.preset === 'occasion' ? t('merchPresetOccasionName') : dialog.preset === 'recipient' ? t('merchPresetRecipientName') : '' },
            { id: 'nameEn', label: t('merchFacetNameEn'), dir: 'ltr', value: dialog.preset === 'occasion' ? 'Occasion' : dialog.preset === 'recipient' ? 'Recipient' : '' },
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
            await finish();
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'edit-facet' ? (
        <FieldsDialog
          t={t}
          title={t('merchEdit')}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'name', label: t('merchFacetName'), required: true, value: dialog.facet.name },
            { id: 'nameEn', label: t('merchFacetNameEn'), dir: 'ltr', value: dialog.facet.nameEn ?? '' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const result = await updateFacet(dialog.facet.id, { name: v.name.trim(), nameEn: v.nameEn?.trim() || null });
            if (!result.ok) return writeFailureMessage(result, t);
            await finish();
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
            { id: 'name', label: t('merchValueName'), required: true, value: '' },
            { id: 'nameEn', label: t('merchValueNameEn'), dir: 'ltr', value: '' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const result = await createFacetValue(dialog.facet.id, { name: v.name.trim(), nameEn: v.nameEn?.trim() || undefined });
            if (!result.ok) return writeFailureMessage(result, t);
            await finish();
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'edit-value' ? (
        <FieldsDialog
          t={t}
          title={`${t('merchEdit')} — ${dialog.value.name}`}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'name', label: t('merchValueName'), required: true, value: dialog.value.name },
            { id: 'nameEn', label: t('merchValueNameEn'), dir: 'ltr', value: dialog.value.nameEn ?? '' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const result = await updateFacetValue(dialog.facet.id, dialog.value.id, { name: v.name.trim(), nameEn: v.nameEn?.trim() || null });
            if (!result.ok) return writeFailureMessage(result, t);
            await finish();
            return null;
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
