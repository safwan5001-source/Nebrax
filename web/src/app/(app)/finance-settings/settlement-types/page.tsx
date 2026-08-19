'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface SettlementType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  settlements_count: number;
}

const EMPTY_FORM = { name: '', description: '', is_active: true };

export default function SettlementTypesPage() {
  const t = useTranslations('financeSettings');
  const { success, error: toastError } = useToast();
  const [types, setTypes] = useState<SettlementType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SettlementType | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: SettlementType[] }>('/settlement-types')
      .then((response) => setTypes(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadSettlementTypesFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => load(), [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(type: SettlementType) {
    setEditing(type);
    setForm({ name: type.name, description: type.description ?? '', is_active: type.is_active });
    setFormError(null);
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError(t('settlementTypeNameRequired'));
      return;
    }

    setSaving(true);
    setFormError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      is_active: form.is_active,
    };

    try {
      if (editing) {
        await api(`/settlement-types/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/settlement-types', { method: 'POST', body });
      }
      success(editing ? t('settlementTypeUpdated') : t('settlementTypeCreated'));
      setDialogOpen(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveSettlementTypeFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(type: SettlementType) {
    if (!window.confirm(t('confirmDeleteSettlementType', { name: type.name }))) return;

    setDeleting(type.id);
    try {
      await api(`/settlement-types/${type.id}`, { method: 'DELETE' });
      success(t('settlementTypeDeleted'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('deleteSettlementTypeFailed'));
    } finally {
      setDeleting(null);
    }
  }

  function actions(type: SettlementType) {
    return (
      <div className="flex justify-end gap-1">
        <Button size="icon" variant="ghost" onClick={() => openEdit(type)} aria-label={t('editSettlementType')}>
          <Pencil className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={deleting === type.id}
          onClick={() => remove(type)}
          aria-label={t('deleteSettlementType')}
        >
          <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/finance-settings">
            <Button variant="ghost" size="icon" aria-label={t('backToFinanceSettings')}>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-text">{t('settlementTypesTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('settlementTypesSubtitle')}</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('newSettlementType')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('settlementTypesList')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" aria-label={t('loadingSettlementTypes')}>
              {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : loadError ? (
            <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
          ) : types.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center">
              <p className="font-medium text-text">{t('noSettlementTypes')}</p>
              <p className="mt-1 text-sm text-muted">{t('noSettlementTypesHint')}</p>
              <Button className="mt-4" variant="outline" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('newSettlementType')}
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[42rem] text-sm">
                  <thead className="border-b border-border text-start text-muted">
                    <tr>
                      <th className="px-3 py-3 font-medium">{t('settlementTypeName')}</th>
                      <th className="px-3 py-3 font-medium">{t('settlementTypeDescription')}</th>
                      <th className="px-3 py-3 font-medium">{t('settlementTypeUsage')}</th>
                      <th className="px-3 py-3 font-medium">{t('settlementTypeStatus')}</th>
                      <th className="px-3 py-3 text-end font-medium">{t('settlementTypeActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((type) => (
                      <tr key={type.id} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-3 font-medium text-text">{type.name}</td>
                        <td className="max-w-xs truncate px-3 py-3 text-muted">{type.description || '—'}</td>
                        <td className="num px-3 py-3 text-muted">{type.settlements_count}</td>
                        <td className="px-3 py-3">
                          <Badge tone={type.is_active ? 'positive' : 'muted'}>{type.is_active ? t('active') : t('inactive')}</Badge>
                        </td>
                        <td className="px-3 py-3">{actions(type)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                {types.map((type) => (
                  <article key={type.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-medium text-text">{type.name}</h2>
                        <p className="mt-1 text-sm text-muted">{type.description || '—'}</p>
                      </div>
                      <Badge tone={type.is_active ? 'positive' : 'muted'}>{type.is_active ? t('active') : t('inactive')}</Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                      <span className="text-sm text-muted">{t('settlementTypeUsage')}: <span className="num">{type.settlements_count}</span></span>
                      {actions(type)}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('editSettlementType') : t('newSettlementType')}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settlement-type-name">{t('settlementTypeName')}</Label>
            <Input
              id="settlement-type-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t('namePlaceholder')}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settlement-type-description">{t('settlementTypeDescription')}</Label>
            <Textarea
              id="settlement-type-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              {t('active')}
            </label>
            <p className="text-xs leading-relaxed text-muted">{t('activeHint')}</p>
          </div>
          {formError && <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button disabled={saving} onClick={save}>{saving ? t('savingSettlementType') : t('saveSettlementType')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
