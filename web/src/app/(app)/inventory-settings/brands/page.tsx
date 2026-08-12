'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SettingsHeader } from '@/components/inventory-settings/settings-header';
import { api, ApiError } from '@/lib/api';

interface Brand {
  id: string;
  name: string;
  is_active: boolean;
  products_count?: number;
}

/** العلامات التجارية — قائمة مسطّحة: العلامة لا تُشتقّ من علامة، فلا تسلسل. */
export default function BrandsPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [rows, setRows] = useState<Brand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Brand | null>(null);

  const load = useCallback(() => {
    api<{ data: Brand[] }>('/brands')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => load(), [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim() };
      if (editing) {
        await api(`/brands/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/brands', { method: 'POST', body });
      }
      success(tc('updated'));
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Brand) {
    setError(null);
    try {
      await api(`/brands/${row.id}`, { method: 'DELETE' });
      success(tc('updated'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function reset() {
    setEditing(null);
    setName('');
  }

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('c_brands_t')} subtitle={t('c_brands_d')} />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{editing ? t('brand_edit') : t('brand_new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5 sm:max-w-sm">
              <Label htmlFor="brand-name">{t('brand_name')}</Label>
              <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
            </div>

            {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="outline" onClick={reset}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                  {t('cancel')}
                </Button>
              )}
              <Button type="submit" disabled={busy || !name.trim()}>
                {editing ? <Check className="h-4 w-4" strokeWidth={1.7} /> : <Plus className="h-4 w-4" strokeWidth={1.7} />}
                {editing ? t('brand_save') : t('brand_add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('brand_list')}</CardTitle></CardHeader>
        <CardContent>
          {!rows ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('brand_empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{row.name}</span>
                  {!!row.products_count && (
                    <Badge tone="muted">{t('cat_products', { count: row.products_count })}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('brand_edit')}
                    onClick={() => { setEditing(row); setName(row.name); }}
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
