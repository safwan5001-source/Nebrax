'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Banknote, CheckCircle2, Droplets, FileText, Plus, ReceiptText } from 'lucide-react';
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
import { formatRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';

interface Station { id: string; name: string; code: string; status: string }
interface Nozzle { id: string; nozzle_number: string; fuel_station_id: string; status: string }
interface Shift { id: string; number: string; station_id: string; status: 'open' | 'closed' | 'approved' }
interface Partner { id: string; name: string; type: string }
interface PaymentMethod { id: string; name: string; settlement_type: 'cash' | 'bank'; is_active: boolean }
interface Sale {
  id: string; number: string; status: 'draft' | 'finalized'; fuel_station_id: string; fuel_nozzle_id: string; fuel_shift_id: string | null;
  partner_id: string | null; quantity_milliliters: number; quantity_liters: string; price_per_liter_minor: number | null; price_per_liter: string | null;
  gross_minor: number | null; gross: string | null; fuel_price_tax_mode: 'tax_inclusive' | 'tax_exclusive' | null;
  invoice_id: string | null; invoice_number?: string | null; invoice_tax_inclusive?: boolean | null; invoice_total_minor?: number | null; invoice_remaining_minor?: number | null;
  payment_status: 'unpaid' | 'partially_paid' | 'paid'; paid_minor: number; paid: string; finalized_at: string | null;
  payment_receipts?: Array<{ id: string; number: string | null; amount: string | null; status: string | null }>;
}

function litersToMilliliters(value: string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const normalized = `${whole}${fraction.padEnd(3, '0')}`;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function FuelSalesPage() {
  const t = useTranslations('fuelStationsSales');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [draftOpen, setDraftOpen] = useState(false);
  const [paySale, setPaySale] = useState<Sale | null>(null);
  const [stationId, setStationId] = useState('');
  const [nozzleId, setNozzleId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [liters, setLiters] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const stationName = useCallback((id: string) => stations.find((station) => station.id === id)?.name ?? '—', [stations]);
  const nozzleLabel = useCallback((id: string) => nozzles.find((nozzle) => nozzle.id === id)?.nozzle_number ?? '—', [nozzles]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [salesResult, stationResult, nozzleResult, shiftResult, partnerResult] = await Promise.all([
        api<{ data: Sale[] }>('/fuel-stations/sales'), api<{ data: Station[] }>('/fuel-stations/stations'),
        api<{ data: Nozzle[] }>('/fuel-stations/nozzles'), api<{ data: Shift[] }>('/fuel-stations/shifts?status=open'),
        api<{ data: Partner[] }>('/partners?type=customer'),
      ]);
      setSales(salesResult.data); setStations(stationResult.data.filter((station) => station.status === 'active'));
      setNozzles(nozzleResult.data.filter((nozzle) => nozzle.status === 'active')); setShifts(shiftResult.data);
      setPartners(partnerResult.data.filter((partner) => partner.type === 'customer')); setMethods([]);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('loadFailed')); } finally { setLoading(false); }
  }, [tc]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {}); }, []);

  const stationNozzles = useMemo(() => nozzles.filter((nozzle) => nozzle.fuel_station_id === stationId), [nozzles, stationId]);
  const stationShifts = useMemo(() => shifts.filter((shift) => shift.station_id === stationId), [shifts, stationId]);
  const remainingMinor = paySale?.invoice_remaining_minor ?? 0;

  async function createDraft() {
    const quantity = litersToMilliliters(liters);
    if (!stationId || !nozzleId || !partnerId || !quantity) return;
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/sales', { method: 'POST', body: {
        fuel_station_id: stationId, fuel_nozzle_id: nozzleId, fuel_shift_id: shiftId || null, partner_id: partnerId || null,
        quantity_milliliters: quantity, idempotency_key: crypto.randomUUID(),
      }});
      success(t('draftCreated')); setDraftOpen(false); setStationId(''); setNozzleId(''); setShiftId(''); setPartnerId(''); setLiters(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function finalize(sale: Sale) {
    setBusy(true); setError(null);
    try { await api(`/fuel-stations/sales/${sale.id}/finalize`, { method: 'POST' }); success(t('finalized')); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const openPayment = useCallback(async (sale: Sale) => {
    setPaySale(sale); setPaymentMethodId(''); setPaymentAmount(formatRiyal(String(sale.invoice_remaining_minor ?? 0)).replace(/[^0-9.]/g, '')); setMethods([]); setError(null);
    try {
      const result = await api<{ data: PaymentMethod[] }>(`/fuel-stations/stations/${sale.fuel_station_id}/sale-payment-methods`);
      setMethods(result.data);
      if (result.data.length === 0) setError(t('noPaymentMethodHint'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tc('loadFailed'));
    }
  }, [t, tc]);

  async function collectPayment() {
    if (!paySale || !paymentMethodId || !isValidRiyal(paymentAmount)) return;
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/sales/${paySale.id}/payments`, { method: 'POST', body: {
        payment_method_id: paymentMethodId, amount_minor: riyalToMinor(paymentAmount), idempotency_key: crypto.randomUUID(),
      }});
      success(t('paymentCollected')); setPaySale(null); setPaymentMethodId(''); setPaymentAmount(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const columns = useMemo<ColumnDef<Sale, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num font-medium">{row.original.number}</span> },
    { id: 'station', header: t('station'), cell: ({ row }) => <span>{stationName(row.original.fuel_station_id)} · <span className="num text-muted">{nozzleLabel(row.original.fuel_nozzle_id)}</span></span> },
    { accessorKey: 'quantity_liters', header: t('quantity'), cell: ({ row }) => <span className="num">{row.original.quantity_liters} {t('literUnit')}</span> },
    { accessorKey: 'gross', header: t('officialTotal'), cell: ({ row }) => <span className="num text-end">{row.original.gross ?? '—'}</span> },
    { id: 'invoice', header: t('invoice'), cell: ({ row }) => row.original.invoice_number ? <span className="num">{row.original.invoice_number}</span> : <span className="text-muted">{t('notFinalized')}</span> },
    { id: 'status', header: t('status'), cell: ({ row }) => <div className="flex flex-wrap gap-1"><Badge tone={row.original.status === 'finalized' ? 'positive' : 'warning'}>{row.original.status === 'finalized' ? t('statusFinalized') : t('statusDraft')}</Badge>{row.original.status === 'finalized' && <Badge tone={row.original.payment_status === 'paid' ? 'positive' : 'warning'}>{t(`payment_${row.original.payment_status}`)}</Badge>}</div> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => <div className="flex flex-wrap justify-end gap-1.5">
      {row.original.status === 'draft' && can('fuel.sale.finalize') && <Button size="sm" onClick={() => void finalize(row.original)} disabled={busy}><CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.7} />{t('finalize')}</Button>}
      {row.original.status === 'finalized' && row.original.payment_status !== 'paid' && can('fuel.sale.collect') && <Button variant="outline" size="sm" onClick={() => void openPayment(row.original)}><ReceiptText className="h-3.5 w-3.5" strokeWidth={1.7} />{t('collect')}</Button>}
    </div> },
  ], [busy, can, nozzleLabel, openPayment, stationName, t]);

  if (loading && sales.length === 0) return <div className="space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-64 w-full" /></div>;

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div><Button disabled={!can('fuel.sale.create') || stations.length === 0} title={!can('fuel.sale.create') ? t('createPermissionHint') : undefined} onClick={() => { setDraftOpen(true); setStationId(''); setNozzleId(''); setShiftId(''); setPartnerId(''); setLiters(''); setError(null); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('newSale')}</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Summary icon={<FileText />} label={t('summaryAll')} value={String(sales.length)} /><Summary icon={<CheckCircle2 />} label={t('summaryFinalized')} value={String(sales.filter((sale) => sale.status === 'finalized').length)} /><Summary icon={<Banknote />} label={t('summaryPaid')} value={String(sales.filter((sale) => sale.payment_status === 'paid').length)} /><Summary icon={<Droplets />} label={t('summaryLiters')} value={`${sales.filter((sale) => sale.status === 'finalized').reduce((total, sale) => total + Number(sale.quantity_liters), 0).toFixed(3)} ${t('literUnit')}`} /></div>
    <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs text-text">{t('separationNotice')}</p>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <DataTable columns={columns} data={sales} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="fuel-sales" />

    <Dialog open={draftOpen} onClose={() => setDraftOpen(false)} title={t('draftTitle')}><form onSubmit={(event) => { event.preventDefault(); void createDraft(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('draftHint')}</p><div className="grid gap-3 sm:grid-cols-2"><FieldSelect id="fuel-sale-station" label={t('station')} value={stationId} onChange={(value) => { setStationId(value); setNozzleId(''); setShiftId(''); }} disabled={busy} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} placeholder={t('selectStation')} /><FieldSelect id="fuel-sale-nozzle" label={t('nozzle')} value={nozzleId} onChange={setNozzleId} disabled={busy || !stationId} options={stationNozzles.map((nozzle) => ({ value: nozzle.id, label: nozzle.nozzle_number }))} placeholder={t('selectNozzle')} /></div><div className="grid gap-3 sm:grid-cols-2"><FieldSelect id="fuel-sale-shift" label={t('shift')} value={shiftId} onChange={setShiftId} disabled={busy || !stationId} options={stationShifts.map((shift) => ({ value: shift.id, label: shift.number }))} placeholder={t('noShift')} optional /><FieldSelect id="fuel-sale-partner" label={t('customer')} value={partnerId} onChange={setPartnerId} disabled={busy} options={partners.map((partner) => ({ value: partner.id, label: partner.name }))} placeholder={t('selectCustomer')} /></div><div className="space-y-1.5"><Label htmlFor="fuel-sale-liters">{t('quantity')}</Label><Input id="fuel-sale-liters" className="num text-end" inputMode="decimal" value={liters} onChange={(event) => setLiters(event.target.value)} required /></div><p className="text-xs text-muted">{t('serverPriceHint')}</p><DialogActions busy={busy} disabled={!stationId || !nozzleId || !partnerId || !litersToMilliliters(liters)} onCancel={() => setDraftOpen(false)} saveLabel={t('createDraft')} /></form></Dialog>

    <Dialog open={!!paySale} onClose={() => setPaySale(null)} title={t('paymentTitle')}><form onSubmit={(event) => { event.preventDefault(); void collectPayment(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('paymentHint', { number: paySale?.number ?? '—', amount: formatRiyal(String(remainingMinor)) })}</p><FieldSelect id="fuel-sale-method" label={t('paymentMethod')} value={paymentMethodId} onChange={setPaymentMethodId} disabled={busy} options={methods.map((method) => ({ value: method.id, label: `${method.name} · ${method.settlement_type === 'cash' ? t('cash') : t('bank')}` }))} placeholder={t('selectPaymentMethod')} /><div className="space-y-1.5"><Label htmlFor="fuel-sale-payment-amount">{t('amount')}</Label><Input id="fuel-sale-payment-amount" className="num text-end" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div><p className="text-xs text-muted">{t('paymentSeparationHint')}</p><DialogActions busy={busy} disabled={!paymentMethodId || !isValidRiyal(paymentAmount)} onCancel={() => setPaySale(null)} saveLabel={t('collect')} /></form></Dialog>
  </div>;
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>; }
function FieldSelect({ id, label, value, onChange, disabled, options, placeholder, optional = false }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; options: Array<{ value: string; label: string }>; placeholder: string; optional?: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={!optional} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function DialogActions({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; saveLabel: string }) { const tc = useTranslations('common'); return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button><Button type="submit" disabled={busy || disabled}>{saveLabel}</Button></div>; }
