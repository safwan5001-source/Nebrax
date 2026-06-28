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

interface SalesSettings {
  default_tax_rate: number;
  default_payment_type: string;
  invoice_prefix: string;
  default_terms: string;
}

export default function InvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [form, setForm] = useState<SalesSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: SalesSettings }>('/sales-settings').then((r) => setForm(r.data)).catch(() => {});
  }, []);

  const set = <K extends keyof SalesSettings>(k: K, v: SalesSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-settings', {
        method: 'PUT',
        body: {
          default_tax_rate: Number(form.default_tax_rate) || 0,
          default_payment_type: form.default_payment_type,
          invoice_prefix: form.invoice_prefix || null,
          default_terms: form.default_terms || null,
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/sales-settings')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('invoices_title')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('c_invoices_t')}</CardTitle></CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rate">{t('default_tax_rate')}</Label>
                  <Input id="rate" className="num text-end" type="number" min={0} max={100} value={form.default_tax_rate} onChange={(e) => set('default_tax_rate', Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt">{t('default_payment_type')}</Label>
                  <Select id="pt" value={form.default_payment_type} onChange={(e) => set('default_payment_type', e.target.value)}>
                    <option value="cash">{t('cash')}</option>
                    <option value="credit">{t('credit')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prefix">{t('invoice_prefix')}</Label>
                  <Input id="prefix" dir="ltr" maxLength={10} value={form.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="terms">{t('default_terms')}</Label>
                <Input id="terms" value={form.default_terms} onChange={(e) => set('default_terms', e.target.value)} />
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
