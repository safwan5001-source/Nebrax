'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';

const PLANS = ['free', 'basic', 'pro', 'enterprise'] as const;

interface PriceVersion {
  id: string;
  plan: string;
  currency: string;
  monthly_amount: string;
  monthly_amount_minor: number;
  effective_on: string | null;
  created_at: string | null;
}

export default function PlatformPricesPage() {
  const t = useTranslations('platformPrices');
  const router = useRouter();
  const [prices, setPrices] = useState<PriceVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState('basic');
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<{ data: PriceVersion[] }>('/platform/prices');
      setPrices(response.data);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    load();
  }, [load, router]);

  async function save(): Promise<void> {
    const amount = riyalToMinor(monthlyPrice);
    if (!isValidRiyal(monthlyPrice) || amount < 0) {
      setError(t('saveFailed'));
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await platformApi<{ data: PriceVersion }>('/platform/prices', {
        method: 'POST',
        body: { plan, currency: 'SAR', monthly_amount: amount, effective_on: effectiveOn },
      });
      setPrices((current) => [response.data, ...current].sort((a, b) => a.plan.localeCompare(b.plan) || (b.effective_on ?? '').localeCompare(a.effective_on ?? '')));
      setMonthlyPrice('');
      setNotice(t('saved'));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            <Tag className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
          </div>
          <Button asChild variant="outline" size="sm"><Link href='/platform'><ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('back')}</Link></Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {error && <Card><CardContent className="p-5"><p className="text-sm text-negative" role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={load}>{t('retry')}</Button></CardContent></Card>}
        {notice && <div className="rounded border border-positive/20 bg-positive/10 px-3 py-2 text-sm text-positive" role="status">{notice}</div>}

        <Card>
          <CardHeader><CardTitle>{t('newPrice')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('plan')}</span><Select value={plan} onChange={(event) => setPlan(event.target.value)}>{PLANS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label>
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('monthlyPrice')}</span><Input inputMode="decimal" value={monthlyPrice} onChange={(event) => setMonthlyPrice(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('effectiveOn')}</span><Input type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} /></label>
            <Button onClick={save} disabled={saving || !monthlyPrice || !effectiveOn}>{saving ? t('saving') : t('save')}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('history')}</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : prices.length === 0 ? <p className="text-sm text-muted">{t('empty')}</p> : <>
              <div className="hidden overflow-x-auto md:block"><Table><THead><TR><TH>{t('plan')}</TH><TH className="text-end">{t('price')}</TH><TH>{t('currency')}</TH><TH>{t('effectiveOn')}</TH></TR></THead><TBody>{prices.map((price) => <TR key={price.id}><TD className="font-medium">{price.plan}</TD><TD className="num text-end">{formatRiyal(price.monthly_amount)}</TD><TD className="num">{price.currency}</TD><TD className="num text-muted">{price.effective_on ?? '—'}</TD></TR>)}</TBody></Table></div>
              <div className="space-y-3 md:hidden">{prices.map((price) => <div key={price.id} className="rounded border border-border p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-text">{price.plan}</p><p className="num text-text">{formatRiyal(price.monthly_amount)}</p></div><p className="num mt-2 text-xs text-muted">{price.currency} · {price.effective_on ?? '—'}</p></div>)}</div>
            </>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
