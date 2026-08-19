'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, ArrowRight, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CashBankAccount } from '@/lib/cash-bank';
import { riyalToMinor } from '@/lib/money';

export default function CashBankTransferPage() {
  const t = useTranslations('cashBank');
  const tc = useTranslations('common');
  const router = useRouter();
  const query = useSearchParams();
  const { success, error: toastError } = useToast();
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [allowNegative, setAllowNegative] = useState(false);
  const [form, setForm] = useState({ source: query.get('source') ?? '', destination: '', amount: '', date: new Date().toISOString().slice(0, 10), reference: '', notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: CashBankAccount[] }>('/cash-bank-accounts'), api<{ data: { allow_negative_transfer_balance: boolean } }>('/settings/finance')])
      .then(([accountResponse, settings]) => { setAccounts(accountResponse.data.filter((item) => item.is_active)); setAllowNegative(settings.data.allow_negative_transfer_balance); })
      .catch((err) => toastError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [tc, toastError]);
  useEffect(() => load(), [load]);

  const source = useMemo(() => accounts.find((item) => item.id === form.source), [accounts, form.source]);
  const destinations = useMemo(() => accounts.filter((item) => item.id !== form.source && (!source || item.currency === source.currency)), [accounts, form.source, source]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/cash-bank-transfers', { method: 'POST', body: { source_cash_bank_account_id: form.source, destination_cash_bank_account_id: form.destination, amount: riyalToMinor(form.amount), transfer_date: form.date, reference: form.reference || null, notes: form.notes || null } });
      success(t('transfer_success'));
      router.push(`/cash-and-bank/${form.source}`);
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setSaving(false); }
  }

  async function savePolicy(value: boolean) {
    setAllowNegative(value); setPolicySaving(true);
    try { await api('/settings/finance', { method: 'PUT', body: { allow_negative_transfer_balance: value } }); success(t('settings_saved')); }
    catch (err) { setAllowNegative(!value); toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setPolicySaving(false); }
  }

  if (loading) return <div className="mx-auto max-w-3xl space-y-5"><div className="h-12 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  return <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Link href="/cash-and-bank"><Button type="button" variant="ghost" size="icon" aria-label={t('back')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button></Link><div><h1 className="text-xl font-semibold text-text">{t('transfer_title')}</h1><p className="mt-1 text-sm text-muted">{t('same_currency_only')}</p></div></div><Button disabled={saving}><ArrowLeftRight className="h-4 w-4" strokeWidth={1.7} />{t('submit_transfer')}</Button></div>
    <Card><CardHeader><CardTitle>{t('transfer')}</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium text-text"><span>{t('source')}</span><Select required value={form.source} onChange={(e) => { set('source', e.target.value); set('destination', ''); }}><option value="">—</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</Select></label><label className="space-y-2 text-sm font-medium text-text"><span>{t('destination')}</span><Select required value={form.destination} onChange={(e) => set('destination', e.target.value)}><option value="">—</option>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</Select></label></div><div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium text-text"><span>{t('amount')}</span><Input required inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></label><label className="space-y-2 text-sm font-medium text-text"><span>{t('date')}</span><Input required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label></div><label className="block space-y-2 text-sm font-medium text-text"><span>{t('reference')}</span><Input value={form.reference} onChange={(e) => set('reference', e.target.value)} /></label><label className="block space-y-2 text-sm font-medium text-text"><span>{t('notes')}</span><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label></CardContent></Card>
    <Card><CardHeader><CardTitle>{t('negative_balance_setting')}</CardTitle></CardHeader><CardContent><div className="flex items-start justify-between gap-4"><p className="text-sm leading-6 text-muted">{t('negative_balance_hint')}</p><Switch checked={allowNegative} disabled={policySaving} onCheckedChange={savePolicy} aria-label={t('negative_balance_setting')} /></div></CardContent></Card>
  </form>;
}
