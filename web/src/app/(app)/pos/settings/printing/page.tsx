'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface ReceiptConfig {
  receipt_footer: string;
  print_receipt: boolean;
  receipt_paper_size: 'thermal_58' | 'thermal_80';
}

const DEFAULTS: ReceiptConfig = {
  receipt_footer: '',
  print_receipt: true,
  receipt_paper_size: 'thermal_80',
};

export default function PosPrintingSettingsPage() {
  const t = useTranslations('posSettings');
  const ts = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [config, setConfig] = useState<ReceiptConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: Partial<ReceiptConfig> }>('/sales-config/pos');
      setConfig({ ...DEFAULTS, ...result.data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function patch<K extends keyof ReceiptConfig>(key: K, value: ReceiptConfig[K]) {
    setConfig((current) => current ? { ...current, [key]: value } : current);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-config/pos', { method: 'PUT', body: { data: config } });
      success(tc('updated'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}><Link href='/pos/settings'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('printing_title')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('printing_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted">{t('printing_subtitle')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : !config ? (
            <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? t('load_failed')}</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                  type="checkbox"
                  checked={config.print_receipt}
                  onChange={(event) => patch('print_receipt', event.target.checked)}
                />
                {t('print_receipt')}
              </label>

              <section className="space-y-1.5">
                <Label htmlFor="receipt_paper_size">{t('receipt_paper_size')}</Label>
                <Select
                  id="receipt_paper_size"
                  value={config.receipt_paper_size}
                  onChange={(event) => patch('receipt_paper_size', event.target.value as ReceiptConfig['receipt_paper_size'])}
                >
                  <option value="thermal_80">{t('receipt_paper_80')}</option>
                  <option value="thermal_58">{t('receipt_paper_58')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('receipt_paper_size_hint')}</p>
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="receipt_footer">{t('receipt_footer')}</Label>
                <textarea
                  id="receipt_footer"
                  value={config.receipt_footer}
                  onChange={(event) => patch('receipt_footer', event.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <p className="text-xs leading-relaxed text-muted">{t('receipt_footer_hint')}</p>
              </section>

              {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={saving}>{ts('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
