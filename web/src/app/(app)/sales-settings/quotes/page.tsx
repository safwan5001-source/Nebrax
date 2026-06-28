'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface SalesSettings {
  quote_validity_days: number;
}

export default function QuoteSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [form, setForm] = useState<SalesSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: SalesSettings }>('/sales-settings').then((r) => setForm({ quote_validity_days: r.data.quote_validity_days })).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-settings', {
        method: 'PUT',
        body: { quote_validity_days: Number(form.quote_validity_days) || 0 },
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
        <h1 className="text-xl font-semibold text-text">{t('quotes_title')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('c_quotes_t')}</CardTitle></CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5 sm:max-w-xs">
                <Label htmlFor="valid">{t('quote_validity_days')}</Label>
                <Input id="valid" className="num text-end" type="number" min={0} max={365} value={form.quote_validity_days} onChange={(e) => setForm({ quote_validity_days: Number(e.target.value) })} />
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
