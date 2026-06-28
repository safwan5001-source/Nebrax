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

interface CustomerSettings {
  default_type: string;
  default_city: string;
  payment_terms_days: number;
  require_tax_number: boolean;
  loyalty_enabled: boolean;
}

export default function CustomerSettingsPage() {
  const t = useTranslations('customerSettings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState<CustomerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: CustomerSettings }>('/customer-settings').then((r) => setForm(r.data)).catch(() => {});
  }, []);

  function set<K extends keyof CustomerSettings>(k: K, v: CustomerSettings[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/customer-settings', {
        method: 'PUT',
        body: {
          default_type: form.default_type,
          default_city: form.default_city || null,
          payment_terms_days: Number(form.payment_terms_days) || 0,
          require_tax_number: form.require_tax_number,
          loyalty_enabled: form.loyalty_enabled,
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
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="type">{t('default_type')}</Label>
                  <Select id="type" value={form.default_type} onChange={(e) => set('default_type', e.target.value)}>
                    <option value="customer">{t('customer')}</option>
                    <option value="supplier">{t('supplier')}</option>
                    <option value="both">{t('both')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="city">{t('default_city')}</Label>
                  <Input id="city" value={form.default_city} onChange={(e) => set('default_city', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="terms">{t('payment_terms_days')}</Label>
                  <Input id="terms" className="num text-end" type="number" min={0} max={365} value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', Number(e.target.value))} />
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={form.require_tax_number} onChange={(e) => set('require_tax_number', e.target.checked)} />
                  {t('require_tax_number')}
                </label>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={form.loyalty_enabled} onChange={(e) => set('loyalty_enabled', e.target.checked)} />
                  {t('loyalty_enabled')}
                </label>
              </div>

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
