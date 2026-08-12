'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface InventorySettings {
  allow_negative_stock: boolean;
}

/**
 * إعدادات المخزون — سياسة تشغيلية بأثر محاسبي مباشر، لا تفضيل شكلي.
 *
 * `allow_negative_stock` تقرؤه `InventoryService` على مسارَي البيع وإرجاع
 * المشتريات. تخفيفه يفتح باباً لرصيدٍ دائن على حساب أصل (1140) ولمتوسط
 * متحرّك مُفسَد — فالتحذير أدناه جزءٌ من الشاشة لا زينة.
 */
export default function InventorySettingsPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [form, setForm] = useState<InventorySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: InventorySettings }>('/inventory-settings')
      .then((r) => setForm(r.data))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/inventory-settings', {
        method: 'PUT',
        body: { allow_negative_stock: form.allow_negative_stock },
      });
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('policy')}</CardTitle></CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="negative">{t('allow_negative_stock')}</Label>
                <Select
                  id="negative"
                  className="sm:max-w-sm"
                  value={form.allow_negative_stock ? '1' : '0'}
                  onChange={(e) => setForm({ allow_negative_stock: e.target.value === '1' })}
                >
                  <option value="0">{t('mode_reject')}</option>
                  <option value="1">{t('mode_allow')}</option>
                </Select>
                <p className="text-xs text-muted">{t('allow_negative_stock_hint')}</p>
              </div>

              {form.allow_negative_stock && (
                <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                  {t('allow_warning')}
                </p>
              )}

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={saving}>{t('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
