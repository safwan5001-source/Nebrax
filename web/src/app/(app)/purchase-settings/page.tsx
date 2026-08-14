'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface PurchaseSettings {
  default_tax_rate: number;
  default_payment_type: string;
  default_tax_inclusive: boolean;
  purchase_prefix: string;
  require_return_source: boolean;
  return_window_days: number;
}

/**
 * إعدادات المشتريات — تفضيلات لا أثر محاسبي لها بذاتها.
 * كل حقل هنا تقرؤه خدمةٌ فعلاً: البادئة في ترقيم الفاتورة، والبقية قيماً
 * افتراضية عند غياب المُرسَل.
 */
export default function PurchaseSettingsPage() {
  const t = useTranslations('purchaseSettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [form, setForm] = useState<PurchaseSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: PurchaseSettings }>('/purchase-settings')
      .then((r) => setForm(r.data))
      .catch(() => {});
  }, []);

  const set = <K extends keyof PurchaseSettings>(key: K, value: PurchaseSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/purchase-settings', {
        method: 'PUT',
        body: {
          default_tax_rate: Number(form.default_tax_rate) || 0,
          default_payment_type: form.default_payment_type,
          default_tax_inclusive: form.default_tax_inclusive,
          purchase_prefix: form.purchase_prefix || null,
          require_return_source: form.require_return_source,
          return_window_days: form.return_window_days,
        },
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
        <CardHeader><CardTitle>{t('defaults')}</CardTitle></CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rate">{t('default_tax_rate')}</Label>
                  <Input
                    id="rate" className="num text-end" type="number" min={0} max={100}
                    value={form.default_tax_rate}
                    onChange={(e) => set('default_tax_rate', Number(e.target.value))}
                  />
                  <p className="text-xs text-muted">{t('default_tax_rate_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payment">{t('default_payment_type')}</Label>
                  <Select
                    id="payment" value={form.default_payment_type}
                    onChange={(e) => set('default_payment_type', e.target.value)}
                  >
                    <option value="credit">{t('payment_credit')}</option>
                    <option value="cash">{t('payment_cash')}</option>
                  </Select>
                  <p className="text-xs text-muted">{t('default_payment_type_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="inclusive">{t('default_tax_inclusive')}</Label>
                  <Select
                    id="inclusive" value={form.default_tax_inclusive ? '1' : '0'}
                    onChange={(e) => set('default_tax_inclusive', e.target.value === '1')}
                  >
                    <option value="0">{t('tax_exclusive')}</option>
                    <option value="1">{t('tax_inclusive')}</option>
                  </Select>
                  <p className="text-xs text-muted">{t('default_tax_inclusive_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prefix">{t('purchase_prefix')}</Label>
                  <Input
                    id="prefix" dir="ltr" maxLength={10}
                    value={form.purchase_prefix}
                    onChange={(e) => set('purchase_prefix', e.target.value)}
                  />
                  <p className="num text-xs text-muted">
                    {t('purchase_prefix_hint')} {(form.purchase_prefix || 'BILL')}-2026-00001
                  </p>
                  {/* التباسٌ متوقَّع: «ترقيم المستند» ≠ «ترقيم ZATCA». */}
                  <p className="text-xs leading-relaxed text-muted">{t('numbering_excludes_icv')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="require-source">{t('require_return_source')}</Label>
                  <Select
                    id="require-source" value={form.require_return_source ? '1' : '0'}
                    onChange={(e) => set('require_return_source', e.target.value === '1')}
                  >
                    <option value="0">{t('require_return_source_off')}</option>
                    <option value="1">{t('require_return_source_on')}</option>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{t('require_return_source_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="return-window">{t('return_window_days')}</Label>
                  <Input
                    id="return-window" className="num text-end" type="number" min={0} max={3650}
                    value={form.return_window_days}
                    onChange={(e) => set('return_window_days', Number(e.target.value) || 0)}
                  />
                  <p className="text-xs leading-relaxed text-muted">{t('return_window_days_hint')}</p>
                </div>
              </div>

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
