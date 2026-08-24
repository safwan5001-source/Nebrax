'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, FileText, PauseCircle, Plus, ShieldCheck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatMinorRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type: string }
interface Contract {
  id: string; number: string; partner_id: string; status: 'draft' | 'active' | 'suspended' | 'expired' | 'cancelled';
  effective_from: string; credit_limit_minor: number; payment_terms_days: number;
}

const STATUS_TONE: Record<Contract['status'], 'positive' | 'warning' | 'negative' | 'neutral'> = {
  draft: 'warning', active: 'positive', suspended: 'warning', expired: 'neutral', cancelled: 'negative',
};

export default function CorporateFuelContractsPage() {
  const t = useTranslations('fuelStationsCorporate');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false); const [partnerId, setPartnerId] = useState(''); const [limit, setLimit] = useState(''); const [terms, setTerms] = useState('0'); const [from, setFrom] = useState('');
  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const partnerName = useCallback((id: string) => partners.find((item) => item.id === id)?.name ?? '—', [partners]);
  const statusLabel = useCallback((status: Contract['status']) => t(`status_${status}`), [t]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [contractResult, partnerResult] = await Promise.all([
        api<{ data: Contract[] }>('/fuel-stations/corporate-contracts'), api<{ data: Partner[] }>('/partners?type=customer'),
      ]);
      setContracts(contractResult.data); setPartners(partnerResult.data.filter((item) => item.type === 'customer'));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('loadFailed')); } finally { setLoading(false); }
  }, [tc]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {}); }, []);

  async function create() {
    const paymentTerms = Number(terms); const creditLimitMinor = riyalToMinor(limit);
    if (!partnerId || !Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0 || !Number.isSafeInteger(paymentTerms) || paymentTerms < 0 || !from) return;
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/corporate-contracts', { method: 'POST', body: { partner_id: partnerId, effective_from: `${from}T00:00:00`, credit_limit_minor: creditLimitMinor, payment_terms_days: paymentTerms } });
      success(t('created')); setOpen(false); setPartnerId(''); setLimit(''); setTerms('0'); setFrom(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function transition(contract: Contract, action: 'activate' | 'suspend') {
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/corporate-contracts/${contract.id}/${action}`, { method: 'POST', body: {} });
      success(action === 'activate' ? t('activated') : t('suspended')); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const columns = useMemo<ColumnDef<Contract, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num font-medium">{row.original.number}</span> },
    { id: 'partner', header: t('customer'), cell: ({ row }) => partnerName(row.original.partner_id) },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={STATUS_TONE[row.original.status]}>{statusLabel(row.original.status)}</Badge> },
    { accessorKey: 'credit_limit_minor', header: t('creditLimit'), cell: ({ row }) => <span className="num text-end">{formatMinorRiyal(row.original.credit_limit_minor)}</span> },
    { accessorKey: 'payment_terms_days', header: t('paymentTerms'), cell: ({ row }) => <span>{t('days', { count: row.original.payment_terms_days })}</span> },
    { accessorKey: 'effective_from', header: t('effectiveFrom'), cell: ({ row }) => <span className="num">{new Date(row.original.effective_from).toLocaleDateString()}</span> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => <div className="flex flex-wrap justify-end gap-1.5">
      {row.original.status === 'draft' && can('fuel.contract.activate') && <Button size="sm" disabled={busy} onClick={() => void transition(row.original, 'activate')}><CheckCircle2 className="h-3.5 w-3.5" />{t('activate')}</Button>}
      {row.original.status === 'active' && can('fuel.contract.suspend') && <Button size="sm" variant="outline" disabled={busy} onClick={() => void transition(row.original, 'suspend')}><PauseCircle className="h-3.5 w-3.5" />{t('suspend')}</Button>}
    </div> },
  ], [busy, can, partnerName, statusLabel, t]);

  if (loading && contracts.length === 0) return <div className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div><Button disabled={!can('fuel.contract.manage')} title={!can('fuel.contract.manage') ? t('noPermission') : undefined} onClick={() => { setOpen(true); setError(null); }}><Plus className="h-4 w-4" />{t('newContract')}</Button></div>
    <div className="grid gap-3 sm:grid-cols-2"><Info icon={<FileText />} label={t('totalContracts')} value={String(contracts.length)} /><Info icon={<ShieldCheck />} label={t('activeContracts')} value={String(contracts.filter((item) => item.status === 'active').length)} /></div>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <DataTable columns={columns} data={contracts} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="corporate-fuel-contracts" />
    <Dialog open={open} onClose={() => setOpen(false)} title={t('createTitle')}><form onSubmit={(event) => { event.preventDefault(); void create(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('createHint')}</p><div className="space-y-1.5"><Label htmlFor="corporate-contract-partner">{t('customer')}</Label><select id="corporate-contract-partner" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('selectCustomer')}</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2"><MoneyField id="corporate-contract-limit" label={t('creditLimit')} hint={t('moneyHint')} value={limit} onChange={setLimit} /><NumberField id="corporate-contract-terms" label={t('paymentTerms')} hint={t('paymentTermsHint')} value={terms} onChange={setTerms} /></div><div className="space-y-1.5"><Label htmlFor="corporate-contract-from">{t('effectiveFrom')}</Label><Input id="corporate-contract-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></div><div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button><Button type="submit" disabled={busy || !partnerId || !isValidRiyal(limit) || riyalToMinor(limit) < 0 || !from}>{t('create')}</Button></div></form></Dialog>
  </div>;
}

function MoneyField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} inputMode="decimal" className="num text-end" value={value} onChange={(event) => onChange(event.target.value)} required aria-describedby={`${id}-hint`} /><p id={`${id}-hint`} className="text-xs text-muted">{hint}</p></div>; }
function NumberField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" inputMode="numeric" min="0" className="num text-end" value={value} onChange={(event) => onChange(event.target.value)} required aria-describedby={`${id}-hint`} /><p id={`${id}-hint`} className="text-xs text-muted">{hint}</p></div>; }
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>; }
