'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { BarChart3, CircleDollarSign, ClipboardCheck, History, LockKeyhole, Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal, riyalToMinor, isNegative, isValidRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

interface PosDevice { id: string; name: string; code: string | null; warehouse_id: string; is_active: boolean; warehouse?: { id: string; code: string; name: string } | null }
interface PosShift { id: string; name: string; code: string | null; is_active: boolean }
interface Session {
  id: string;
  number: string;
  status: string;
  pos_device_id: string | null;
  warehouse_id: string | null;
  pos_shift_id: string | null;
  shift_id: string | null;
  pos_device?: { id: string; name: string; code: string | null } | null;
  warehouse?: { id: string; code: string; name: string } | null;
  pos_shift?: { id: string; name: string; code: string | null } | null;
  opening_balance: string;
  closing_balance: string | null;
  expected_balance: string | null;
  difference: string | null;
  difference_status: 'pending' | 'acknowledged' | 'not_required' | null;
  difference_acknowledgement: { acknowledged_by: string; acknowledged_at: string; note: string } | null;
  variance_type: 'shortage' | 'overage' | null;
  variance_journal_entry_id: string | null;
  opened_at: string | null;
  closed_at: string | null;
}
interface SessionReport {
  cash_sales: string;
  cash_refunds: string;
  cash_in: string;
  cash_out: string;
  sales_count: number;
  returns_count: number;
  returns_total: string;
  net_sales: string;
  average: string;
  expected: string;
}
interface SessionEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string | null;
  actor?: { id: string; name: string } | null;
}

export default function PosSessionsPage() {
  const t = useTranslations('posSessions');
  const tp = useTranslations('pos');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [movementSessionId, setMovementSessionId] = useState<string | null>(null);
  const [acknowledgementSessionId, setAcknowledgementSessionId] = useState<string | null>(null);
  const [historySession, setHistorySession] = useState<Session | null>(null);
  const [reportSession, setReportSession] = useState<Session | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [movementReason, setMovementReason] = useState('');
  const [acknowledgementNote, setAcknowledgementNote] = useState('');
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [shifts, setShifts] = useState<PosShift[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canAcknowledgeDifference, setCanAcknowledgeDifference] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Session[] }>('/pos-sessions').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => {
    api<{ data: PosDevice[] }>('/pos-devices').then((r) => setDevices(r.data.filter((device) => device.is_active))).catch(() => {});
    api<{ data: PosShift[] }>('/pos-shifts').then((r) => setShifts(r.data.filter((shift) => shift.is_active))).catch(() => {});
  }, []);
  useEffect(() => {
    const user = currentUser();
    const applyPermissions = (permissions: string[] | undefined) => setCanAcknowledgeDifference(
      Boolean(permissions?.includes('*') || permissions?.includes('pos.variance.approve')),
    );
    if (user?.permissions !== undefined) {
      applyPermissions(user.permissions);
      return;
    }
    api<{ user: { permissions?: string[] } }>('/me').then((result) => applyPermissions(result.user.permissions)).catch(() => {});
  }, []);

  async function submitOpen() {
    setBusy(true); setError(null);
    try {
      await api('/pos-sessions/open', { method: 'POST', body: { opening_balance: riyalToMinor(amount), pos_device_id: deviceId, pos_shift_id: shiftId } });
      success(tc('created')); setOpenDialog(false); setAmount(''); setDeviceId(''); setShiftId(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitClose() {
    if (!closeId) return;
    setBusy(true); setError(null);
    try {
      await api(`/pos-sessions/${closeId}/close`, { method: 'POST', body: { closing_balance: riyalToMinor(amount) } });
      success(tc('updated')); setCloseId(null); setAmount(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitMovement() {
    if (!movementSessionId || !isValidRiyal(movementAmount)) return;
    setBusy(true); setError(null);
    try {
      await api(`/pos-sessions/${movementSessionId}/cash-movements`, {
        method: 'POST', body: { type: movementType, amount: riyalToMinor(movementAmount), reason: movementReason },
      });
      success(t('cash_movement_recorded')); setMovementSessionId(null); setMovementAmount(''); setMovementReason(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function submitAcknowledgement() {
    if (!acknowledgementSessionId) return;
    setBusy(true); setError(null);
    try {
      await api(`/pos-sessions/${acknowledgementSessionId}/acknowledge-difference`, { method: 'POST', body: { note: acknowledgementNote } });
      success(t('difference_acknowledged_success')); setAcknowledgementSessionId(null); setAcknowledgementNote(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function settleVariance(sessionId: string) {
    setBusy(true);
    try {
      await api(`/pos-sessions/${sessionId}/settle-variance`, { method: 'POST' });
      success(t('variance_settled_success')); load();
    } catch (e) {
      // خطأ التهيئة (حساب الفروق مفقود/معطّل) يعرض برسالة الخادم الواضحة عبر توست
      // لأن الإجراء بلا حوار؛ لا يترك المستخدم بلا سبب ظاهر.
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally { setBusy(false); }
  }

  async function openReport(session: Session) {
    setReportSession(session); setReport(null); setError(null); setReportLoading(true);
    try {
      const result = await api<{ report: SessionReport }>(`/pos-sessions/${session.id}/report`);
      setReport(result.report);
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('loadFailed')); } finally { setReportLoading(false); }
  }

  async function openHistory(session: Session) {
    setHistorySession(session); setEvents([]); setError(null); setHistoryLoading(true);
    try {
      const result = await api<{ data: SessionEvent[] }>(`/pos-sessions/${session.id}/events`);
      setEvents(result.data);
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('loadFailed')); } finally { setHistoryLoading(false); }
  }

  const eventLabels: Record<string, string> = {
    cash_in_recorded: t('event_cash_in_recorded'),
    cash_out_recorded: t('event_cash_out_recorded'),
    return_recorded: t('event_return_recorded'),
    exchange_recorded: t('event_exchange_recorded'),
    closing_difference_requires_acknowledgement: t('event_closing_difference_requires_acknowledgement'),
    closing_difference_acknowledged: t('event_closing_difference_acknowledged'),
    closing_difference_settled: t('event_closing_difference_settled'),
  };
  const differenceLabels: Record<string, string> = {
    pending: t('difference_pending'),
    acknowledged: t('difference_acknowledged'),
    not_required: t('difference_not_required'),
  };

  const columns = useMemo<ColumnDef<Session, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      { accessorKey: 'opened_at', header: t('opened_at'), cell: ({ row }) => <span className="num text-muted">{(row.original.opened_at ?? '').slice(0, 16).replace('T', ' ')}</span> },
      { id: 'device', header: t('device'), cell: ({ row }) => <span>{row.original.pos_device?.name ?? '—'}</span> },
      { id: 'posShift', header: t('work_shift'), cell: ({ row }) => <span>{row.original.pos_shift?.name ?? '—'}</span> },
      { id: 'warehouse', header: tp('warehouse'), cell: ({ row }) => <span>{row.original.warehouse?.name ?? '—'}</span> },
      { accessorKey: 'opening_balance', header: t('opening_balance'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.opening_balance)}</div> },
      { accessorKey: 'expected_balance', header: t('expected'), cell: ({ row }) => <div className="num text-end">{row.original.expected_balance ? formatRiyal(row.original.expected_balance) : '—'}</div> },
      { accessorKey: 'closing_balance', header: t('closing_balance'), cell: ({ row }) => <div className="num text-end">{row.original.closing_balance ? formatRiyal(row.original.closing_balance) : '—'}</div> },
      {
        accessorKey: 'difference', header: t('difference'),
        cell: ({ row }) => row.original.difference === null ? <div className="text-end text-muted">—</div>
          : <div className={cn('num text-end', isNegative(row.original.difference) && 'text-negative')}>{formatRiyal(row.original.difference)}</div>,
      },
      {
        id: 'differenceStatus', header: t('status'),
        cell: ({ row }) => row.original.status === 'open'
          ? <Badge tone="warning">{t('open_status')}</Badge>
          : row.original.variance_journal_entry_id
            ? <Badge tone="positive">{t('variance_settled')}</Badge>
            : row.original.difference_status
              ? <Badge tone={row.original.difference_status === 'pending' ? 'warning' : 'positive'}>{differenceLabels[row.original.difference_status]}</Badge>
              : <Badge tone="positive">{t('closed_status')}</Badge>,
      },
      {
        id: 'actions', header: t('actions'),
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => openReport(row.original)} aria-label={t('view_report')}>
              <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.7} />{t('view_report')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => openHistory(row.original)} aria-label={t('view_audit')}>
              <History className="h-3.5 w-3.5" strokeWidth={1.7} />{t('view_audit')}
            </Button>
            {row.original.status === 'open' && <>
              <Button variant="outline" size="sm" onClick={() => { setMovementSessionId(row.original.id); setMovementAmount(''); setMovementReason(''); setMovementType('cash_in'); setError(null); }}>
                <CircleDollarSign className="h-3.5 w-3.5" strokeWidth={1.7} />{t('record_movement')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setCloseId(row.original.id); setAmount(''); setError(null); }}>
                <LockKeyhole className="h-3.5 w-3.5" strokeWidth={1.7} />{t('close')}
              </Button>
            </>}
            {row.original.status === 'closed' && row.original.difference_status === 'pending' && (
              <Button variant="outline" size="sm" disabled={!canAcknowledgeDifference} title={!canAcknowledgeDifference ? t('approver_only') : undefined} onClick={() => { setAcknowledgementSessionId(row.original.id); setAcknowledgementNote(''); setError(null); }}>
                <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.7} />{t('acknowledge_difference')}
              </Button>
            )}
            {row.original.status === 'closed' && row.original.difference_status === 'acknowledged' && !row.original.variance_journal_entry_id && (
              <Button variant="outline" size="sm" disabled={!canAcknowledgeDifference || busy} title={!canAcknowledgeDifference ? t('approver_only') : undefined} onClick={() => settleVariance(row.original.id)}>
                <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.7} />{t('settle_variance')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [busy, canAcknowledgeDifference, differenceLabels, t, tp],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => { setOpenDialog(true); setAmount(''); setDeviceId(''); setShiftId(''); setError(null); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />{t('open')}
        </Button>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-sessions" />

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} title={t('open_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitOpen(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="session-device">{t('device')}</Label>
            <select id="session-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required disabled={busy || devices.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{t('select_device')}</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.code ? ` · ${device.code}` : ''}{device.warehouse ? ` — ${device.warehouse.name}` : ''}</option>)}
            </select>
            {devices.length === 0 && <p className="text-xs text-warning">{t('no_device')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-shift">{t('work_shift')}</Label>
            <select id="session-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} required disabled={busy || shifts.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{t('work_shift')}</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}{shift.code ? ` · ${shift.code}` : ''}</option>)}
            </select>
            {shifts.length === 0 && <p className="text-xs text-warning">{t('no_shift')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob">{t('opening_balance')}</Label>
            <Input id="ob" className="num text-end" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !deviceId || !shiftId || !isValidRiyal(amount)}>{t('save')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!closeId} onClose={() => setCloseId(null)} title={t('close_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitClose(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cb">{t('counted')}</Label>
            <Input id="cb" className="num text-end" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCloseId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !isValidRiyal(amount)}>{t('close')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!movementSessionId} onClose={() => setMovementSessionId(null)} title={t('cash_movement_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitMovement(); }} className="space-y-3">
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('cash_movement_hint')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="movement-type">{t('cash_movement')}</Label>
            <select id="movement-type" value={movementType} onChange={(e) => setMovementType(e.target.value as 'cash_in' | 'cash_out')} disabled={busy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="cash_in">{t('cash_in')}</option>
              <option value="cash_out">{t('cash_out')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movement-amount">{t('cash_movement_amount')}</Label>
            <Input id="movement-amount" className="num text-end" inputMode="decimal" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} required aria-invalid={!isValidRiyal(movementAmount) && movementAmount !== ''} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movement-reason">{t('cash_movement_reason')}</Label>
            <Input id="movement-reason" value={movementReason} onChange={(e) => setMovementReason(e.target.value)} placeholder={t('cash_movement_reason_placeholder')} required />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setMovementSessionId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !isValidRiyal(movementAmount) || movementReason.trim().length < 3}>{t('save')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!acknowledgementSessionId} onClose={() => setAcknowledgementSessionId(null)} title={t('acknowledge_difference_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitAcknowledgement(); }} className="space-y-3">
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('acknowledge_difference_hint')}</p>
          <p className="text-xs text-muted">{t('approver_only')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="acknowledgement-note">{t('acknowledgement_note')}</Label>
            <textarea id="acknowledgement-note" value={acknowledgementNote} onChange={(e) => setAcknowledgementNote(e.target.value)} placeholder={t('acknowledgement_note_placeholder')} required className="min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60" />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAcknowledgementSessionId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || acknowledgementNote.trim().length < 3}>{t('acknowledge_difference')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!reportSession} onClose={() => setReportSession(null)} title={t('report_title')}>
        <div className="space-y-3">
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('report_hint')}</p>
          {reportLoading && <p className="text-sm text-muted">{tc('loading')}</p>}
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          {report && <dl className="grid gap-x-5 sm:grid-cols-2">
            {[
              [t('cash_sales'), report.cash_sales],
              [t('cash_refunds'), report.cash_refunds],
              [t('cash_in_total'), report.cash_in],
              [t('cash_out_total'), report.cash_out],
              [t('returns_total'), report.returns_total],
              [t('net_sales'), report.net_sales],
              [t('expected'), report.expected],
              [t('average'), report.average],
            ].map(([label, reportAmount]) => <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm"><dt className="text-muted">{label}</dt><dd className="num font-semibold text-text">{formatRiyal(String(reportAmount))}</dd></div>)}
            <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm"><dt className="text-muted">{t('sales_count')}</dt><dd className="num font-semibold text-text">{report.sales_count}</dd></div>
            <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm"><dt className="text-muted">{t('returns_count')}</dt><dd className="num font-semibold text-text">{report.returns_count}</dd></div>
          </dl>}
        </div>
      </Dialog>

      <Dialog open={!!historySession} onClose={() => setHistorySession(null)} title={t('audit_log_title')}>
        <div className="space-y-3">
          {historyLoading && <p className="text-sm text-muted">{tc('loading')}</p>}
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          {!historyLoading && !error && events.length === 0 && <p className="text-sm text-muted">{t('audit_empty')}</p>}
          {!historyLoading && events.length > 0 && <ol className="divide-y divide-border rounded-md border border-border">
            {events.map((event) => {
              const detail = typeof event.payload?.reason === 'string' ? event.payload.reason : typeof event.payload?.note === 'string' ? event.payload.note : null;
              return <li key={event.id} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="text-text">{eventLabels[event.type] ?? event.type}</span><span className="num shrink-0 text-xs text-muted">{(event.created_at ?? '').slice(0, 16).replace('T', ' ')}</span></div>
                <div className="text-xs text-muted">{event.actor?.name ?? '—'}{detail ? ` · ${detail}` : ''}</div>
              </li>;
            })}
          </ol>}
        </div>
      </Dialog>
    </div>
  );
}
