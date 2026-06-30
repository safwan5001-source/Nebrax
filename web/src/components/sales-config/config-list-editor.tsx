'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'select';
  options?: { value: string; label: string }[];
}
type Row = Record<string, string | number>;

/** محرّر قائمة عام لأقسام إعدادات المبيعات (حالات/قوائم أسعار/مصادر/شحن…). */
export function ConfigListEditor({
  section,
  title,
  description,
  fields,
}: {
  section: string;
  title: string;
  description?: string;
  fields: Field[];
}) {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: Row[] }>(`/sales-config/${section}`)
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]));
  }, [section]);

  const emptyRow = (): Row =>
    Object.fromEntries(fields.map((f) => [f.key, f.type === 'color' ? '#1E40AF' : f.type === 'select' ? (f.options?.[0]?.value ?? '') : '']));

  const setCell = (i: number, key: string, v: string) =>
    setRows((rs) => (rs ? rs.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)) : rs));
  const addRow = () => setRows((rs) => [...(rs ?? []), emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs ? rs.filter((_, idx) => idx !== i) : rs));

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    const payload = rows.map((r) =>
      Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' ? Number(r[f.key]) || 0 : r[f.key] ?? ''])),
    );
    try {
      await api(`/sales-config/${section}`, { method: 'PUT', body: { data: payload } });
      success(tc('updated'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/sales-settings')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{title}</h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('add_row')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!rows ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('empty_list')}</p>
          ) : (
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-end gap-2">
                  {fields.map((f) => (
                    <div key={f.key} className="flex-1 space-y-1">
                      <label className="text-xs text-muted">{f.label}</label>
                      {f.type === 'select' ? (
                        <Select value={String(row[f.key] ?? '')} onChange={(e) => setCell(i, f.key, e.target.value)}>
                          {f.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                        </Select>
                      ) : (
                        <Input
                          type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                          className={f.type === 'number' ? 'num text-end' : f.type === 'color' ? 'h-9 w-16 p-1' : ''}
                          value={String(row[f.key] ?? '')}
                          onChange={(e) => setCell(i, f.key, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                  <Button variant="ghost" size="icon" aria-label={t('remove_row')} onClick={() => removeRow(i)}>
                    <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

          <div className="flex justify-end border-t border-border pt-3">
            <Button disabled={saving || !rows} onClick={save}>{t('save')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
