'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeftRight, Ban, Building2, Landmark, Pencil, Trash2, Wallet } from 'lucide-react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { type CashBankAccount, type CashBankTransfer } from '@/lib/cash-bank';
import { formatRiyal } from '@/lib/money';

type Section = 'details' | 'permissions' | 'transfers' | 'activity';

export default function CashBankDetailPage() {
  const t = useTranslations('cashBank');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [item, setItem] = useState<CashBankAccount | null>(null);
  const [transfers, setTransfers] = useState<CashBankTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [section, setSection] = useState<Section>('details');
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    Promise.all([
      api<{ data: CashBankAccount }>(`/cash-bank-accounts/${params.id}`),
      api<{ data: CashBankTransfer[] }>(`/cash-bank-transfers?cash_bank_account_id=${params.id}`),
    ]).then(([account, history]) => { setItem(account.data); setTransfers(history.data); })
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('load_failed')))
      .finally(() => setLoading(false));
  }, [params.id, t, toastError]);
  useEffect(() => load(), [load]);

  function toggle(next: Section) { if (next === section) setCollapsed((value) => !value); else { setSection(next); setCollapsed(false); } }
  const isOpen = (target: Section) => !collapsed && section === target;

  async function deactivate() {
    if (!item || !window.confirm(t('confirm_deactivate'))) return;
    setActing(true); try { await api(`/cash-bank-accounts/${item.id}/deactivate`, { method: 'POST' }); success(t('deactivated')); load(); } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); } finally { setActing(false); }
  }
  async function makeMain() {
    if (!item) return; setActing(true); try { await api(`/cash-bank-accounts/${item.id}/make-main`, { method: 'POST' }); success(t('main_updated')); load(); } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); } finally { setActing(false); }
  }
  async function remove() {
    if (!item || !window.confirm(t('confirm_delete'))) return;
    setActing(true); try { await api(`/cash-bank-accounts/${item.id}`, { method: 'DELETE' }); success(t('deleted')); router.push('/cash-and-bank'); } catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); } finally { setActing(false); }
  }

  if (loading) return <div className="mx-auto max-w-5xl space-y-5"><div className="h-20 animate-pulse rounded-md bg-muted" /><div className="h-96 animate-pulse rounded-md bg-muted" /></div>;
  if (!item) return <div className="mx-auto max-w-5xl space-y-4"><p className="rounded-md bg-negative/10 px-4 py-3 text-sm text-negative">{t('load_failed')}</p><Button asChild variant="outline"><Link href="/cash-and-bank">{t('back')}</Link></Button></div>;
  const Icon = item.type === 'bank' ? Landmark : Wallet;
  const actions = (mobile = false) => <>
    <Button asChild variant="outline"><Link className={mobile ? 'shrink-0' : undefined} href={`/cash-and-bank/new?edit=${item.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Link></Button>
    {item.is_active && <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting} onClick={deactivate}><Ban className="h-4 w-4" strokeWidth={1.7} />{t('deactivate')}</Button>}
    <Button asChild variant="outline"><Link className={mobile ? 'shrink-0' : undefined} href={`/cash-and-bank/transfer?source=${item.id}`}><ArrowLeftRight className="h-4 w-4" strokeWidth={1.7} />{t('transfer')}</Link></Button>
    {!item.is_main && item.is_active && <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting} onClick={makeMain}><Building2 className="h-4 w-4" strokeWidth={1.7} />{t('make_main')}</Button>}
    <Button className={mobile ? 'shrink-0' : undefined} variant="outline" disabled={acting} onClick={remove}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />{t('delete')}</Button>
  </>;
  const details = <div className="grid grid-cols-1 gap-x-8 gap-y-4 p-4 sm:grid-cols-2 lg:p-0">
    {[[t('name'), item.name], [t('type'), t(item.type)], [t('ledger_account'), [item.account_code, item.account_name].filter(Boolean).join(' — ') || '—'], [t('currency'), item.currency], ...(item.type === 'bank' ? [[t('bank_name'), item.bank_name || '—'], [t('account_number'), item.account_number || '—']] : []), [t('description'), item.description || '—']].map(([label, value]) => <div key={String(label)} className="space-y-1"><dt className="text-sm font-medium text-muted">{label}</dt><dd className="text-sm text-text">{value}</dd></div>)}
  </div>;
  const permissions = <div className="grid gap-4 p-4 sm:grid-cols-2 lg:p-0">{(['deposit', 'withdraw'] as const).map((action) => <div key={action} className="rounded-md border border-border p-3"><p className="text-sm font-medium text-text">{t(action)}</p><p className="mt-1 text-sm text-muted">{t(item[`${action}_scope`])}{item[`${action}_scope_subject`] ? ` — ${item[`${action}_scope_subject`]}` : ''}</p></div>)}</div>;
  const transferContent = <div className="p-4 lg:p-0">{transfers.length === 0 ? <p className="py-5 text-center text-sm text-muted">{t('empty')}</p> : <div className="divide-y divide-border rounded-md border border-border">{transfers.map((transfer) => <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"><div><p className="text-sm font-medium text-text">{transfer.number}</p><p className="text-xs text-muted">{transfer.source_name} ← {transfer.destination_name}</p></div><span className="num text-sm font-medium">{formatRiyal(transfer.amount)}</span></div>)}</div>}</div>;
  const summary = <div className="space-y-3 p-4 lg:p-0"><div className="flex justify-between gap-3"><span className="text-sm text-muted">{t('balance')}</span><span className="num text-lg font-bold text-text">{formatRiyal(item.balance)}</span></div><div className="flex flex-wrap gap-2"><Badge tone={item.is_active ? 'positive' : 'muted'}>{t(item.is_active ? 'active' : 'inactive')}</Badge>{item.is_main && <Badge tone="warning">{t('main')}</Badge>}</div></div>;

  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/cash-and-bank'><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button><div><div className="flex flex-wrap items-center gap-2"><Icon className="h-5 w-5 text-primary" strokeWidth={1.7} /><h1 className="text-xl font-semibold text-text">{item.name}</h1>{item.is_main && <Badge tone="warning">{t('main')}</Badge>}</div><p className="mt-1 text-sm text-muted">{item.account_code} · {t(item.type)}</p></div></div><div className="hidden flex-wrap gap-2 lg:flex">{actions()}</div></div>
    <div className="no-print -mx-4 overflow-x-auto px-4 lg:hidden"><div className="flex w-max gap-2">{actions(true)}</div></div>
    <Accordion className="lg:hidden"><AccordionItem id="cash-bank-details" title={t('details')} open={isOpen('details')} onToggle={() => toggle('details')}>{isOpen('details') && details}</AccordionItem><AccordionItem id="cash-bank-permissions" title={t('permissions')} open={isOpen('permissions')} onToggle={() => toggle('permissions')}>{isOpen('permissions') && permissions}</AccordionItem><AccordionItem id="cash-bank-transfers" title={t('transfers')} count={transfers.length} open={isOpen('transfers')} onToggle={() => toggle('transfers')}>{isOpen('transfers') && transferContent}</AccordionItem><AccordionItem id="cash-bank-activity" title={t('activity')} open={isOpen('activity')} onToggle={() => toggle('activity')}>{isOpen('activity') && <p className="p-4 text-sm text-muted">{t('coming_soon')}</p>}</AccordionItem></Accordion>
    <div className="hidden gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="space-y-5"><Card><CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader><CardContent>{details}</CardContent></Card><Card><CardHeader><CardTitle>{t('permissions')}</CardTitle></CardHeader><CardContent>{permissions}</CardContent></Card><Card><CardHeader><CardTitle>{t('transfers')}</CardTitle></CardHeader><CardContent>{transferContent}</CardContent></Card></div><Card className="h-fit lg:sticky lg:top-5"><CardHeader><CardTitle>{t('financial_summary')}</CardTitle></CardHeader><CardContent>{summary}</CardContent></Card></div>
  </div>;
}
