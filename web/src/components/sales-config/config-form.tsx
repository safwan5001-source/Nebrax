'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'checkbox' | 'select';
  options?: { value: string; label: string }[];
}
type Values = Record<string, string | number | boolean>;

/** نموذج إعدادات عام لأقسام المبيعات الكائنية (الفاتورة الإلكترونية/التصميمات/أوامر البيع). */
export function ConfigForm({
  section,
  title,
  description,
  fields,
  backHref = '/sales-settings',
}: {
  section: string;
  title: string;
  description?: string;
  fields: FormField[];
  backHref?: string;
}) {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: Values }>(`/sales-config/${section}`).then((r) => setValues(r.data ?? {})).catch(() => setValues({}));
  }, [section]);

  const set = (k: string, v: string | number | boolean) => setValues((s) => (s ? { ...s, [k]: v } : s));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setError(null);
    const payload: Values = {};
    for (const f of fields) {
      const v = values[f.key];
      payload[f.key] = f.type === 'number' ? Number(v) || 0 : f.type === 'checkbox' ? Boolean(v) : (v ?? '');
    }
    try {
      await api(`/sales-config/${section}`, { method: 'PUT', body: { data: payload } });
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(backHref)} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{title}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </CardHeader>
        <CardContent>
          {!values ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {fields.map((f) =>
                f.type === 'checkbox' ? (
                  <label key={f.key} className="flex items-center gap-2 text-sm text-text">
                    <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
                    {f.label}
                  </label>
                ) : (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={f.key}>{f.label}</Label>
                    {f.type === 'select' ? (
                      <Select id={f.key} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                        {f.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                      </Select>
                    ) : (
                      <Input
                        id={f.key}
                        type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                        className={f.type === 'number' ? 'num text-end' : f.type === 'color' ? 'h-9 w-16 p-1' : ''}
                        dir={f.type === 'text' ? undefined : 'ltr'}
                        value={String(values[f.key] ?? '')}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    )}
                  </div>
                ),
              )}

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={saving}>{t('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
