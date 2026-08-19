'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Landmark, Save, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CashBankAccount, type CashBankType, PERMISSION_SCOPES, type PermissionScope } from '@/lib/cash-bank';

const todayType = (value: string | null): CashBankType => value === 'bank' ? 'bank' : 'cash';

export default function CashBankFormPage() {
  const t = useTranslations('cashBank');
  const tc = useTranslations('common');
  const router = useRouter();
  const query = useSearchParams();
  const { success, error: toastError } = useToast();
  const editId = query.get('edit');
  const [type, setType] = useState<CashBankType>(todayType(query.get('type')));
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', bank_name: '', account_number: '', currency: 'SAR', description: '', is_active: true,
    deposit_scope: 'all' as PermissionScope, deposit_scope_subject: '',
    withdraw_scope: 'all' as PermissionScope, withdraw_scope_subject: '',
  });

  const load = useCallback(() => {
    if (!editId) return;
    setLoading(true);
    api<{ data: CashBankAccount }>(`/cash-bank-accounts/${editId}`)
      .then(({ data }) => {
        setType(data.type);
        setForm({
          name: data.name, bank_name: data.bank_name ?? '', account_number: data.account_number ?? '', currency: data.currency,
          description: data.description ?? '', is_active: data.is_active,
          deposit_scope: data.deposit_scope, deposit_scope_subject: data.deposit_scope_subject ?? '',
          withdraw_scope: data.withdraw_scope, withdraw_scope_subject: data.withdraw_scope_subject ?? '',
        });
      })
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_failed')))
      .finally(() => setLoading(false));
  }, [editId, t, toastError]);

  useEffect(() => load(), [load]);
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      type, ...form,
      deposit_scope_subject: form.deposit_scope === 'all' ? null : form.deposit_scope_subject || null,
      withdraw_scope_subject: form.withdraw_scope === 'all' ? null : form.withdraw_scope_subject || null,
    };
    try {
      const response = await api<{ data: CashBankAccount }>(editId ? `/cash-bank-accounts/${editId}` : '/cash-bank-accounts', {
        method: editId ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      success(editId ? t('updated') : t('saved'));
      router.push(`/cash-and-bank/${response.data.id}`);
    } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="mx-auto max-w-3xl space-y-5"><div className="h-12 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  const Icon = type === 'bank' ? Landmark : Wallet;

  return <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Link href="/cash-and-bank"><Button type="button" variant="ghost" size="icon" aria-label={t('back')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button></Link><div><h1 className="text-xl font-semibold text-text">{editId ? t('edit_title', { name: form.name }) : t(type === 'bank' ? 'new_bank' : 'new_cash')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div></div>
      <Button disabled={saving}><Save className="h-4 w-4" strokeWidth={1.7} />{t('save')}</Button>
    </div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" strokeWidth={1.7} />{t('account_info')}</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium text-text"><span>{t('name')}</span><Input required value={form.name} placeholder={t('name_placeholder')} onChange={(e) => set('name', e.target.value)} /></label><label className="space-y-2 text-sm font-medium text-text"><span>{t('currency')}</span><Select value={form.currency} onChange={(e) => set('currency', e.target.value)}><option value="SAR">SAR</option></Select></label></div>
      {type === 'bank' && <div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium text-text"><span>{t('bank_name')}</span><Input required value={form.bank_name} placeholder={t('bank_name_placeholder')} onChange={(e) => set('bank_name', e.target.value)} /></label><label className="space-y-2 text-sm font-medium text-text"><span>{t('account_number')}</span><Input required value={form.account_number} onChange={(e) => set('account_number', e.target.value)} /></label></div>}
      <label className="block space-y-2 text-sm font-medium text-text"><span>{t('description')}</span><Textarea value={form.description} placeholder={t('description_placeholder')} onChange={(e) => set('description', e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-border accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" />{t('active')}</label>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>{t('permissions')}</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
      {(['deposit', 'withdraw'] as const).map((action) => {
        const scopeKey = `${action}_scope` as const; const subjectKey = `${action}_scope_subject` as const;
        return <div key={action} className="space-y-3 rounded-md border border-border p-4"><p className="text-sm font-medium text-text">{t(action)}</p><label className="block space-y-2 text-sm text-muted"><span>{t('scope')}</span><Select value={form[scopeKey]} onChange={(e) => set(scopeKey, e.target.value as PermissionScope)}>{PERMISSION_SCOPES.map((scope) => <option key={scope} value={scope}>{t(scope)}</option>)}</Select></label>{form[scopeKey] !== 'all' && <label className="block space-y-2 text-sm text-muted"><span>{t('scope_subject')}</span><Input required value={form[subjectKey]} onChange={(e) => set(subjectKey, e.target.value)} /></label>}</div>;
      })}
    </CardContent></Card>
  </form>;
}
