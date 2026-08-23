'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Droplets, Gauge, History, LockKeyhole, Plus, ReceiptText, WalletCards } from 'lucide-react';
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
import { formatMinorRiyal, isNegative, isValidRiyal, riyalToMinor } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Station { id: string; name: string; code: string; status: string }
interface Nozzle { id: string; nozzle_number: string; fuel_station_id: string; status: string }
interface Tank { id: string; code: string; name: string; fuel_station_id: string; status: string }
interface ShiftEvent { id: string; type: string; payload: Record<string, unknown>; occurred_at: string | null }
interface MeterReading { id: string; nozzle_id: string; reading_stage: 'opening' | 'closing'; meter_liters: string; measured_at: string | null }
interface TankReading { id: string; tank_id: string; reading_stage: 'opening' | 'closing'; reading_type: 'physical' | 'atg'; quantity_liters: string; measured_at: string | null }
interface CashMovement { id: string; type: 'cash_in' | 'cash_out' | 'expense'; amount_minor: number; reason: string; recorded_at: string | null }
interface Shift {
  id: string; number: string; status: 'open' | 'closed' | 'approved'; station_id: string;
  opening_float_minor: number; counted_cash_minor: number | null; expected_operational_cash_minor: number | null; cash_variance_minor: number | null;
  operational_meter_milliliters: number; operational_liters: string; operational_tank_variance_milliliters: number | null;
  opened_at: string | null; closed_at: string | null; approved_at: string | null; locked_at: string | null;
  staff_assignments?: unknown[]; meter_readings?: MeterReading[]; tank_readings?: TankReading[]; cash_movements?: CashMovement[];
  events?: ShiftEvent[]; cash_variance?: { status: 'not_required' | 'pending_review'; variance_direction: string; note: string | null; reviewed_by: string | null } | null;
}

type ReadingKind = 'meter' | 'tank';

export default function FuelShiftsPage() {
  const t = useTranslations('fuelStationsShifts');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [readingShift, setReadingShift] = useState<Shift | null>(null);
  const [cashShift, setCashShift] = useState<Shift | null>(null);
  const [closeShift, setCloseShift] = useState<Shift | null>(null);
  const [approveShift, setApproveShift] = useState<Shift | null>(null);
  const [reviewShift, setReviewShift] = useState<Shift | null>(null);
  const [auditShift, setAuditShift] = useState<Shift | null>(null);
  const [stationId, setStationId] = useState('');
  const [openingFloat, setOpeningFloat] = useState('0');
  const [readingKind, setReadingKind] = useState<ReadingKind>('meter');
  const [readingStage, setReadingStage] = useState<'opening' | 'closing'>('opening');
  const [assetId, setAssetId] = useState('');
  const [readingLiters, setReadingLiters] = useState('');
  const [readingType, setReadingType] = useState<'physical' | 'atg'>('physical');
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out' | 'expense'>('cash_in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const stationName = useCallback((id: string) => stations.find((station) => station.id === id)?.name ?? '—', [stations]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [shiftResult, stationResult, nozzleResult, tankResult] = await Promise.all([
        api<{ data: Shift[] }>('/fuel-stations/shifts'),
        api<{ data: Station[] }>('/fuel-stations/stations'),
        api<{ data: Nozzle[] }>('/fuel-stations/nozzles'),
        api<{ data: Tank[] }>('/fuel-stations/tanks'),
      ]);
      setShifts(shiftResult.data); setStations(stationResult.data.filter((station) => station.status === 'active'));
      setNozzles(nozzleResult.data.filter((nozzle) => nozzle.status === 'active'));
      setTanks(tankResult.data.filter((tank) => tank.status === 'active'));
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('loadFailed')); } finally { setLoading(false); }
  }, [tc]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const user = currentUser();
    if (user?.permissions) { setPermissions(user.permissions); return; }
    api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {});
  }, []);

  const filteredAssets = useMemo(() => {
    if (!readingShift) return [] as Array<Nozzle | Tank>;
    return readingKind === 'meter'
      ? nozzles.filter((nozzle) => nozzle.fuel_station_id === readingShift.station_id)
      : tanks.filter((tank) => tank.fuel_station_id === readingShift.station_id);
  }, [nozzles, readingKind, readingShift, tanks]);

  async function submitOpen() {
    if (!stationId || !isValidRiyal(openingFloat)) return;
    setBusy(true); setError(null);
    try {
      const created = await api<{ data: Shift }>('/fuel-stations/shifts/open', {
        method: 'POST', body: { fuel_station_id: stationId, opening_float_minor: riyalToMinor(openingFloat), idempotency_key: crypto.randomUUID() },
      });
      const user = currentUser();
      if (user?.id) await api(`/fuel-stations/shifts/${created.data.id}/staff`, { method: 'POST', body: { user_id: user.id, role: 'attendant' } });
      success(t('openedSuccess')); setOpenDialog(false); setStationId(''); setOpeningFloat('0'); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitReading() {
    if (!readingShift || !assetId || !/^\d+(?:\.\d{1,3})?$/.test(readingLiters)) return;
    setBusy(true); setError(null);
    try {
      const endpoint = readingKind === 'meter' ? 'meter-readings' : 'tank-readings';
      const body = readingKind === 'meter'
        ? { fuel_nozzle_id: assetId, reading_stage: readingStage, meter_liters: readingLiters, evidence_key: crypto.randomUUID() }
        : { fuel_tank_id: assetId, reading_stage: readingStage, reading_type: readingType, quantity_liters: readingLiters, evidence_key: crypto.randomUUID() };
      await api(`/fuel-stations/shifts/${readingShift.id}/${endpoint}`, { method: 'POST', body });
      success(t('readingSaved')); setReadingShift(null); setAssetId(''); setReadingLiters(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitCash() {
    if (!cashShift || !isValidRiyal(movementAmount) || movementReason.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/shifts/${cashShift.id}/cash-movements`, {
        method: 'POST', body: { type: movementType, amount_minor: riyalToMinor(movementAmount), reason: movementReason, idempotency_key: crypto.randomUUID() },
      });
      success(t('movementSaved')); setCashShift(null); setMovementAmount(''); setMovementReason(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitClose() {
    if (!closeShift || !isValidRiyal(countedCash)) return;
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/shifts/${closeShift.id}/close`, { method: 'POST', body: { counted_cash_minor: riyalToMinor(countedCash), closing_note: closingNote || null } });
      success(t('closedSuccess')); setCloseShift(null); setCountedCash(''); setClosingNote(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitReviewVariance() {
    if (!reviewShift || reviewNote.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/shifts/${reviewShift.id}/cash-variance/review`, { method: 'POST', body: { note: reviewNote } });
      success(t('varianceReviewed')); setReviewShift(null); setReviewNote(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitApprove() {
    if (!approveShift) return;
    setBusy(true); setError(null);
    try {
      await api(`/fuel-stations/shifts/${approveShift.id}/approve`, { method: 'POST', body: { note: approvalNote || null } });
      success(t('approvedSuccess')); setApproveShift(null); setApprovalNote(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const statusLabel: Record<Shift['status'], string> = { open: t('statusOpen'), closed: t('statusClosed'), approved: t('statusApproved') };
  const columns = useMemo<ColumnDef<Shift, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num font-medium">{row.original.number}</span> },
    { id: 'station', header: t('station'), cell: ({ row }) => stationName(row.original.station_id) },
    { accessorKey: 'opened_at', header: t('openedAt'), cell: ({ row }) => <span className="num text-muted">{(row.original.opened_at ?? '').slice(0, 16).replace('T', ' ') || '—'}</span> },
    { accessorKey: 'operational_liters', header: t('operationalLiters'), cell: ({ row }) => <span className="num text-end">{row.original.operational_liters}</span> },
    { accessorKey: 'cash_variance_minor', header: t('cashVariance'), cell: ({ row }) => row.original.cash_variance_minor === null ? <span className="text-muted">—</span> : <span className={cn('num', isNegative(String(row.original.cash_variance_minor)) && 'text-negative')}>{formatMinorRiyal(row.original.cash_variance_minor)}</span> },
    { id: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'open' ? 'warning' : row.original.cash_variance?.status === 'pending_review' ? 'warning' : 'positive'}>{statusLabel[row.original.status]}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => <div className="flex flex-wrap justify-end gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => setAuditShift(row.original)} aria-label={t('audit')}><History className="h-3.5 w-3.5" strokeWidth={1.7} />{t('audit')}</Button>
      {row.original.status === 'open' && can('fuel.shift.open') && <Button variant="outline" size="sm" onClick={() => { setReadingShift(row.original); setReadingKind('meter'); setReadingStage('opening'); setAssetId(''); setReadingLiters(''); setError(null); }}><Gauge className="h-3.5 w-3.5" strokeWidth={1.7} />{t('recordReading')}</Button>}
      {row.original.status === 'open' && can('fuel.shift.cash_count') && <Button variant="outline" size="sm" onClick={() => { setCashShift(row.original); setMovementType('cash_in'); setMovementAmount(''); setMovementReason(''); setError(null); }}><WalletCards className="h-3.5 w-3.5" strokeWidth={1.7} />{t('cashMovement')}</Button>}
      {row.original.status === 'open' && can('fuel.shift.close') && can('fuel.shift.cash_count') && <Button variant="outline" size="sm" onClick={() => { setCloseShift(row.original); setCountedCash(''); setClosingNote(''); setError(null); }}><LockKeyhole className="h-3.5 w-3.5" strokeWidth={1.7} />{t('close')}</Button>}
      {row.original.cash_variance?.status === 'pending_review' && !row.original.cash_variance.reviewed_by && can('fuel.shift.cash_variance_review') && <Button variant="outline" size="sm" onClick={() => { setReviewShift(row.original); setReviewNote(''); setError(null); }}><ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.7} />{t('reviewVariance')}</Button>}
      {row.original.status === 'closed' && can('fuel.shift.approve') && <Button variant="outline" size="sm" onClick={() => { setApproveShift(row.original); setApprovalNote(''); setError(null); }}><ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.7} />{t('approve')}</Button>}
    </div> },
  ], [can, stationName, statusLabel, t]);

  if (loading && shifts.length === 0) return <div className="space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-64 w-full" /></div>;

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div>
      <Button disabled={!can('fuel.shift.open') || stations.length === 0} title={!can('fuel.shift.open') ? t('openPermissionHint') : stations.length === 0 ? t('noStationHint') : undefined} onClick={() => { setOpenDialog(true); setStationId(''); setOpeningFloat('0'); setError(null); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('open')}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Summary icon={<Gauge />} label={t('summaryOpen')} value={String(shifts.filter((shift) => shift.status === 'open').length)} />
      <Summary icon={<Droplets />} label={t('summaryOperational')} value={`${shifts.reduce((total, shift) => total + Number(shift.operational_liters || 0), 0)} ${t('literUnit')}`} />
      <Summary icon={<WalletCards />} label={t('summaryPendingCash')} value={String(shifts.filter((shift) => shift.cash_variance?.status === 'pending_review').length)} />
      <Summary icon={<ReceiptText />} label={t('summaryLocked')} value={String(shifts.filter((shift) => shift.status === 'approved').length)} />
    </div>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <DataTable columns={columns} data={shifts} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="fuel-shifts" />

    <Dialog open={openDialog} onClose={() => setOpenDialog(false)} title={t('openTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitOpen(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('openHint')}</p>
        <div className="space-y-1.5"><Label htmlFor="fuel-shift-station">{t('station')}</Label><select id="fuel-shift-station" value={stationId} onChange={(event) => setStationId(event.target.value)} required disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('selectStation')}</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.name} · {station.code}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="fuel-shift-opening-float">{t('openingFloat')}</Label><Input id="fuel-shift-opening-float" className="num text-end" inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} required /></div>
        <p className="text-xs text-muted">{t('selfAssignmentHint')}</p><DialogActions busy={busy} disabled={!stationId || !isValidRiyal(openingFloat)} onCancel={() => setOpenDialog(false)} saveLabel={t('open')} />
      </form>
    </Dialog>

    <Dialog open={!!readingShift} onClose={() => setReadingShift(null)} title={t('readingTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitReading(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('readingHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="reading-kind">{t('readingKind')}</Label><select id="reading-kind" value={readingKind} onChange={(event) => { setReadingKind(event.target.value as ReadingKind); setAssetId(''); }} disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="meter">{t('meter')}</option><option value="tank">{t('tank')}</option></select></div><div className="space-y-1.5"><Label htmlFor="reading-stage">{t('readingStage')}</Label><select id="reading-stage" value={readingStage} onChange={(event) => setReadingStage(event.target.value as 'opening' | 'closing')} disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="opening">{t('opening')}</option><option value="closing">{t('closing')}</option></select></div></div>
        {readingKind === 'tank' && <div className="space-y-1.5"><Label htmlFor="reading-type">{t('readingType')}</Label><select id="reading-type" value={readingType} onChange={(event) => setReadingType(event.target.value as 'physical' | 'atg')} disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="physical">{t('physical')}</option><option value="atg">{t('atg')}</option></select></div>}
        <div className="space-y-1.5"><Label htmlFor="reading-asset">{readingKind === 'meter' ? t('nozzle') : t('tank')}</Label><select id="reading-asset" value={assetId} onChange={(event) => setAssetId(event.target.value)} required disabled={busy || filteredAssets.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('selectAsset')}</option>{filteredAssets.map((asset) => <option key={asset.id} value={asset.id}>{'nozzle_number' in asset ? asset.nozzle_number : `${asset.name} · ${asset.code}`}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="reading-liters">{t('readingLiters')}</Label><Input id="reading-liters" className="num text-end" inputMode="decimal" value={readingLiters} onChange={(event) => setReadingLiters(event.target.value)} required /></div><DialogActions busy={busy} disabled={!assetId || !/^\d+(?:\.\d{1,3})?$/.test(readingLiters)} onCancel={() => setReadingShift(null)} saveLabel={t('saveReading')} />
      </form>
    </Dialog>

    <Dialog open={!!cashShift} onClose={() => setCashShift(null)} title={t('cashTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitCash(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('cashHint')}</p>
        <div className="space-y-1.5"><Label htmlFor="cash-type">{t('cashType')}</Label><select id="cash-type" value={movementType} onChange={(event) => setMovementType(event.target.value as 'cash_in' | 'cash_out' | 'expense')} disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="cash_in">{t('cashIn')}</option><option value="cash_out">{t('cashOut')}</option><option value="expense">{t('expense')}</option></select></div>
        <div className="space-y-1.5"><Label htmlFor="cash-amount">{t('amount')}</Label><Input id="cash-amount" className="num text-end" inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="cash-reason">{t('reason')}</Label><Input id="cash-reason" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} required /></div><DialogActions busy={busy} disabled={!isValidRiyal(movementAmount) || movementReason.trim().length < 3} onCancel={() => setCashShift(null)} saveLabel={t('saveMovement')} />
      </form>
    </Dialog>

    <Dialog open={!!closeShift} onClose={() => setCloseShift(null)} title={t('closeTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitClose(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('closeHint')}</p><div className="space-y-1.5"><Label htmlFor="counted-cash">{t('countedCash')}</Label><Input id="counted-cash" className="num text-end" inputMode="decimal" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="closing-note">{t('closingNote')}</Label><textarea id="closing-note" value={closingNote} onChange={(event) => setClosingNote(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" /></div><DialogActions busy={busy} disabled={!isValidRiyal(countedCash)} onCancel={() => setCloseShift(null)} saveLabel={t('close')} /></form>
    </Dialog>

    <Dialog open={!!reviewShift} onClose={() => setReviewShift(null)} title={t('reviewVarianceTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitReviewVariance(); }} className="space-y-3"><p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-text">{t('reviewVarianceHint')}</p><div className="space-y-1.5"><Label htmlFor="variance-review-note">{t('reviewNote')}</Label><textarea id="variance-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" /></div><DialogActions busy={busy} disabled={reviewNote.trim().length < 3} onCancel={() => setReviewShift(null)} saveLabel={t('reviewVariance')} /></form>
    </Dialog>

    <Dialog open={!!approveShift} onClose={() => setApproveShift(null)} title={t('approveTitle')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitApprove(); }} className="space-y-3"><p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-text">{t('approveHint')}</p><div className="space-y-1.5"><Label htmlFor="approval-note">{t('approvalNote')}</Label><textarea id="approval-note" value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" /></div><DialogActions busy={busy} disabled={false} onCancel={() => setApproveShift(null)} saveLabel={t('approve')} /></form>
    </Dialog>

    <Dialog open={!!auditShift} onClose={() => setAuditShift(null)} title={t('auditTitle')}><div className="space-y-3">{auditShift?.cash_variance?.status === 'pending_review' && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-text">{t('pendingVarianceHint')}</p>}{!auditShift?.events?.length && <p className="text-sm text-muted">{t('auditEmpty')}</p>}<ol className="divide-y divide-border rounded-md border border-border">{auditShift?.events?.map((event) => <li key={event.id} className="flex items-start justify-between gap-3 px-3 py-2.5"><div><p className="text-sm text-text">{event.type}</p><p className="text-xs text-muted">{typeof event.payload?.reason === 'string' ? event.payload.reason : typeof event.payload?.note === 'string' ? event.payload.note : t('eventRecorded')}</p></div><span className="num shrink-0 text-xs text-muted">{(event.occurred_at ?? '').slice(0, 16).replace('T', ' ')}</span></li>)}</ol></div></Dialog>
  </div>;
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>;
}

function DialogActions({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; saveLabel: string }) {
  const tc = useTranslations('common');
  return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button><Button type="submit" disabled={busy || disabled}>{saveLabel}</Button></div>;
}
