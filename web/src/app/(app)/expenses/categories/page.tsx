'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  expenses_count?: number;
}

const emptyForm = { name: '', description: '', is_active: true };

export default function ExpenseCategoriesPage() {
  const t = useTranslations('expenses');
  const { success, error: toastError } = useToast();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: ExpenseCategory[] }>('/expense-categories')
      .then((response) => setCategories(response.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('load_categories_failed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => load(), [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(category: ExpenseCategory) {
    setEditing(category);
    setForm({ name: category.name, description: category.description ?? '', is_active: category.is_active });
    setError(null);
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError(t('category_name_required'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() || null, is_active: form.is_active };
      if (editing) {
        await api(`/expense-categories/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/expense-categories', { method: 'POST', body });
      }
      success(editing ? t('category_updated') : t('category_created'));
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('save_category_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(category: ExpenseCategory) {
    if (!window.confirm(t('confirm_delete_category', { name: category.name }))) return;

    setDeleting(category.id);
    try {
      await api(`/expense-categories/${category.id}`, { method: 'DELETE' });
      success(t('category_deleted'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('delete_category_failed'));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href="/expenses">
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
            </Link></Button>
          <div>
            <h1 className="text-xl font-semibold text-text">{t('categories_title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('categories_subtitle')}</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('new_category')}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('categories_list')}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" aria-label={t('loading_categories')}>
              {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : error ? (
            <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>
          ) : categories.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center">
              <p className="font-medium text-text">{t('no_categories')}</p>
              <p className="mt-1 text-sm text-muted">{t('no_categories_hint')}</p>
              <Button className="mt-4" variant="outline" onClick={openCreate}><Plus className="h-4 w-4" />{t('new_category')}</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="border-b border-border text-start text-muted">
                  <tr>
                    <th className="px-3 py-3 font-medium">{t('category_name')}</th>
                    <th className="px-3 py-3 font-medium">{t('category_description')}</th>
                    <th className="px-3 py-3 font-medium">{t('category_usage')}</th>
                    <th className="px-3 py-3 font-medium">{t('status')}</th>
                    <th className="px-3 py-3 text-end font-medium">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id} className="border-b border-border/70 last:border-0">
                      <td className="px-3 py-3 font-medium text-text">{category.name}</td>
                      <td className="max-w-xs truncate px-3 py-3 text-muted">{category.description || '—'}</td>
                      <td className="num px-3 py-3 text-muted">{category.expenses_count ?? 0}</td>
                      <td className="px-3 py-3"><Badge tone={category.is_active ? 'positive' : 'muted'}>{category.is_active ? t('active') : t('inactive')}</Badge></td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(category)} aria-label={t('edit_category')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>
                          <Button size="icon" variant="ghost" disabled={deleting === category.id} onClick={() => remove(category)} aria-label={t('delete_category')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit_category') : t('new_category')}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">{t('category_name')}</Label>
            <Input id="category-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-description">{t('category_description')}</Label>
            <textarea id="category-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40" />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 rounded border-input accent-primary" />
            {t('active')}
          </label>
          {error && <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button disabled={saving} onClick={save}>{saving ? t('saving') : t('save_category')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
