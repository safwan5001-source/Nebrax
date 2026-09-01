'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { BarChart3, CircleDollarSign, ClipboardCheck, Eye, History, LockKeyhole, Plus, ShieldCheck } from 'lucide-react';
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
  handover_status: 'pending' | 'confirmed' | null;
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
  handover_confirmed_at: string | null;
}
interface ClosingPreviewMethod { payment_method_id: string | null; payment_method_name: string; settlement_type: string; expected_amount: string | null }
interface ClosingPreview {
  cash_drawer: { reconciliation_key: string; name: string; settlement_type: 'cash'; expected_amount: string | null };
  payment_methods: ClosingPreviewMethod[];
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
interface SessionRegisterSummary {
  total_count: number;
  open_count: number;
  handover_pending_count: number;
  difference_pending_count: number;
  handover_confirmed_count: number;
}

export default function PosSessionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('posSessions');
  const tp = useTranslations('pos');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();
  const [data, setData] = useState<Session[]>([]);
  const [summary, setSummary] = useState<SessionRegisterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [handoverStatusFilter, setHandoverStatusFilter] = useState(searchParams.get('handover_status') ?? '');
  const [differenceStatusFilter, setDifferenceStatusFilter] = useState(searchParams.get('difference_status') ?? '');
  const [deviceFilter, setDeviceFilter] = useState(searchParams.get('pos_device_id') ?? '');
  const [shiftFilter, setShiftFilter] = useState(searchParams.get('pos_shift_id') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') ?? '');
  const [openDialog, setOpenDialog] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closePreview, setClosePreview] = useState<ClosingPreview | null>(null);
  const [closePreviewLoading, setClosePreviewLoading] = useState(false);
  const [paymentCounts, setPaymentCounts] = useState<Record<string, string>>({});
  const [handoverNote, setHandoverNote] = useState('');
  const [handoverSessionId, setHandoverSessionId] = useState<string | null>(null);
  const [handoverConfirmationNote, setHandoverConfirmationNote] = useState('');
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
  const [filterDevices, setFilterDevices] = useState<PosDevice[]>([]);
  const [filterShifts, setFilterShifts] = useState<PosShift[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canAcknowledgeDifference, setCanAcknowledgeDifference] = useState(false);
  const [canConfirmHandover, setCanConfirmHandover] = useState(false);
  const registerRequestId = useRef(0);

  const registerQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (handoverStatusFilter) params.set('handover_status', handoverStatusFilter);
    if (differenceStatusFilter) params.set('difference_status', differenceStatusFilter);
    if (deviceFilter) params.set('pos_device_id', deviceFilter);
    if (shiftFilter) params.set('pos_shift_id', shiftFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params.toString();
  }, [dateFrom, dateTo, deviceFilter, differenceStatusFilter, handoverStatusFilter, shiftFilter, statusFilter]);

  const load = useCallback(() => {
    const requestId = ++registerRequestId.current;
    setLoading(true);
    setListError(null);
    api<{ data: Session[]; meta?: { summary?: SessionRegisterSummary; filters?: { devices?: PosDevice[]; shifts?: PosShift[] } } }>(`/pos-sessions${registerQuery ? `?${registerQuery}` : ''}`)
      .then((r) => {
        if (requestId !== registerRequestId.current) return;
        setData(r.data);
        setSummary(r.meta?.summary ?? null);
        setFilterDevices(r.meta?.filters?.devices ?? []);
        setFilterShifts(r.meta?.filters?.shifts ?? []);
      })
      .catch((cause) => {
        if (requestId !== registerRequestId.current) return;
        setSummary(null);
        setListError(cause instanceof ApiError ? cause.message : tc('loadFailed'));
      })
      .finally(() => {
        if (requestId === registerRequestId.current) setLoading(false);
      });
  }, [registerQuery, tc]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    router.replace(registerQuery ? `${pathname}?${registerQuery}` : pathname, { scroll: false });
  }, [pathname, registerQuery, router]);
  useEffect(() => {
    api<{ data: PosDevice[] }>('/pos-devices').then((r) => setDevices(r.data)).catch(() => {});
    api<{ data: PosShift[] }>('/pos-shifts').then((r) => setShifts(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    const user = currentUser();
    const applyPermissions = (permissions: string[] | undefined) => {
      setCanAcknowledgeDifference(Boolean(permissions?.includes('*') || permissions?.includes('pos.variance.approve')));
      setCanConfirmHandover(Boolean(permissions?.includes('*') || permissions?.includes('pos.session.handover.confirm')));
    };
    if (user?.permissions !== undefined) {
      applyPermissions(user.permissions);
      return;
    }
    api<{ user: { permissions?: string[] } }>('/me').then((result) => applyPermissions(result.user.permissions)).catch(() => {});
  }, []);

  const activeDevices = useMemo(() => devices.filter((device) => device.is_active), [devices]);
  const activeShifts = useMemo(() => shifts.filter((shift) => shift.is_active), [shifts]);
  const hasRegisterFilters = Boolean(statusFilter || handoverStatusFilter || differenceStatusFilter || deviceFilter || shiftFilter || dateFrom || dateTo);

  function clearRegisterFilters() {
    setStatusFilter('');
    setHandoverStatusFilter('');
    setDifferenceStatusFilter('');
    setDeviceFilter('');
    setShiftFilter('');
    setDateFrom('');
    setDateTo('');
  }

  function applyQueueView(view: 'open' | 'handover_pending' | 'difference_pending' | 'handover_confirmed') {
    setDeviceFilter('');
    setShiftFilter('');
    setDateFrom('');
    setDateTo('');
    if (view === 'open') {
      setStatusFilter('open'); setHandoverStatusFilter(''); setDifferenceStatusFilter('');
    } else if (view === 'handover_pending') {
      setStatusFilter('closed'); setHandoverStatusFilter('pending'); setDifferenceStatusFilter('');
    } else if (view === 'difference_pending') {
      setStatusFilter('closed'); setHandoverStatusFilter(''); setDifferenceStatusFilter('pending');
    } else {
      setStatusFilter('closed'); setHandoverStatusFilter('confirmed'); setDifferenceStatusFilter('');
    }
  }

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
      const counts = (closePreview?.payment_methods ?? [])
        .filter((method): method is ClosingPreviewMethod & { payment_method_id: string } => Boolean(method.payment_method_id))
        .map((method) => ({ payment_method_id: method.payment_method_id, counted_amount: riyalToMinor(paymentCounts[method.payment_method_id]) }));
      await api(`/pos-sessions/${closeId}/close`, {
        method: 'POST',
        body: { closing_balance: riyalToMinor(amount), payment_counts: counts, handover_note: handoverNote.trim() || null },
      });
      success(t('handover_submitted_success')); setCloseId(null); setAmount(''); setClosePreview(null); setPaymentCounts({}); setHandoverNote(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function prepareClose(session: Session) {
    setCloseId(session.id); setAmount(''); setError(null); setClosePreview(null); setPaymentCounts({}); setHandoverNote(''); setClosePreviewLoading(true);
    try {
      const result = await api<{ data: ClosingPreview }>(`/pos-sessions/${session.id}/closing-preview`);
      const preview = result.data;
      if (!preview?.cash_drawer || !Array.isArray(preview.payment_methods)) {
        throw new Error('Invalid POS closing preview response.');
      }
      setClosePreview(preview);
      setPaymentCounts(Object.fromEntries(preview.payment_methods.filter((method) => method.payment_method_id).map((method) => [method.payment_method_id as string, ''])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    } finally {
      setClosePreviewLoading(false);
    }
  }

  async function submitHandoverConfirmation() {
    if (!handoverSessionId) return;
    setBusy(true); setError(null);
    try {
      await api(`/pos-sessions/${handoverSessionId}/confirm-handover`, { method: 'POST', body: { note: handoverConfirmationNote.trim() } });
      success(t('handover_confirmed_success')); setHandoverSessionId(null); setHandoverConfirmationNote(''); load();
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
    session_handover_submitted: t('event_handover_submitted'),
    session_handover_confirmed: t('event_handover_confirmed'),
  };
  const differenceLabels: Record<string, string> = {
    pending: t('difference_pending'),
    acknowledged: t('difference_acknowledged'),
    not_required: t('difference_not_required'),
  };

  const columns = useMemo<ColumnDef<Session, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/pos/sessions/${row.original.id}`} className="num font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{row.original.number}</Link> },
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
          : row.original.difference_status === 'pending'
            ? <Badge tone="warning">{differenceLabels.pending}</Badge>
            : row.original.handover_status === 'pending'
              ? <Badge tone="warning">{t('handover_pending')}</Badge>
              : row.original.handover_status === 'confirmed'
                ? <Badge tone="positive">{t('handover_confirmed')}</Badge>
                : row.original.variance_journal_entry_id
            ? <Badge tone="positive">{t('variance_settled')}</Badge>
            : row.original.difference_status
              ? <Badge tone="positive">{differenceLabels[row.original.difference_status]}</Badge>
              : <Badge tone="positive">{t('closed_status')}</Badge>,
      },
      {
        id: 'actions', header: t('actions'),
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/pos/sessions/${row.original.id}`} aria-label={t('view_details')}><Eye className="h-3.5 w-3.5" strokeWidth={1.7} />{t('view_details')}</Link>
            </Button>
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
              <Button variant="outline" size="sm" onClick={() => void prepareClose(row.original)}>
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
            {row.original.status === 'closed' && row.original.handover_status === 'pending' && (
              <Button variant="outline" size="sm" disabled={!canConfirmHandover || row.original.difference_status === 'pending' || busy} title={!canConfirmHandover ? t('handover_approver_only') : row.original.difference_status === 'pending' ? t('handover_resolve_variance_first') : undefined} onClick={() => { setHandoverSessionId(row.original.id); setHandoverConfirmationNote(''); setError(null); }}>
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.7} />{t('confirm_handover')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [busy, canAcknowledgeDifference, canConfirmHandover, differenceLabels, t, tp],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => { setOpenDialog(true); setAmount(''); setDeviceId(''); setShiftId(''); setError(null); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />{t('open')}
        </Button>
      </div>

      {summary && <section aria-label={t('queue_overview')} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { id: 'open', label: t('open_status'), value: summary.open_count, active: statusFilter === 'open' && !handoverStatusFilter && !differenceStatusFilter },
          { id: 'handover_pending', label: t('handover_pending'), value: summary.handover_pending_count, active: statusFilter === 'closed' && handoverStatusFilter === 'pending' && !differenceStatusFilter },
          { id: 'difference_pending', label: t('difference_pending'), value: summary.difference_pending_count, active: statusFilter === 'closed' && !handoverStatusFilter && differenceStatusFilter === 'pending' },
          { id: 'handover_confirmed', label: t('handover_confirmed'), value: summary.handover_confirmed_count, active: statusFilter === 'closed' && handoverStatusFilter === 'confirmed' && !differenceStatusFilter },
        ].map((item) => <button key={item.id} type="button" aria-pressed={item.active} onClick={() => applyQueueView(item.id as 'open' | 'handover_pending' | 'difference_pending' | 'handover_confirmed')} className={cn('flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-start transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', item.active && 'border-primary bg-primary-soft')}><span className="text-sm text-muted">{item.label}</span><strong className="num text-lg font-semibold text-text">{item.value}</strong></button>)}
      </section>}

      <section aria-label={t('register_filters')} className="rounded border border-border bg-surface p-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <div className="space-y-1.5"><Label htmlFor="session-status-filter">{t('filter_status')}</Label><select id="session-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('all_statuses')}</option><option value="open">{t('open_status')}</option><option value="closed">{t('closed_status')}</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="session-handover-filter">{t('filter_handover_status')}</Label><select id="session-handover-filter" value={handoverStatusFilter} onChange={(event) => setHandoverStatusFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('all_handover_statuses')}</option><option value="pending">{t('handover_pending')}</option><option value="confirmed">{t('handover_confirmed')}</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="session-difference-filter">{t('filter_difference_status')}</Label><select id="session-difference-filter" value={differenceStatusFilter} onChange={(event) => setDifferenceStatusFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('all_difference_statuses')}</option><option value="pending">{t('difference_pending')}</option><option value="acknowledged">{t('difference_acknowledged')}</option><option value="not_required">{t('difference_not_required')}</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="session-device-filter">{t('filter_device')}</Label><select id="session-device-filter" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('all_devices')}</option>{filterDevices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.code ? ` · ${device.code}` : ''}</option>)}</select></div>
          <div className="space-y-1.5"><Label htmlFor="session-shift-filter">{t('filter_shift')}</Label><select id="session-shift-filter" value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{t('all_shifts')}</option>{filterShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}{shift.code ? ` · ${shift.code}` : ''}</option>)}</select></div>
          <div className="space-y-1.5"><Label htmlFor="session-date-from">{t('date_from')}</Label><Input id="session-date-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="num h-9" /></div>
          <div className="space-y-1.5"><Label htmlFor="session-date-to">{t('date_to')}</Label><Input id="session-date-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="num h-9" /></div>
        </div>
        {hasRegisterFilters && <div className="mt-3 flex justify-end"><Button variant="ghost" size="sm" onClick={clearRegisterFilters}>{t('clear_filters')}</Button></div>}
      </section>

      <DataTable columns={columns} data={data} loading={loading} error={listError} onRetry={load} retryLabel={t('retry')} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-sessions" />

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} title={t('open_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitOpen(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="session-device">{t('device')}</Label>
            <select id="session-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required disabled={busy || activeDevices.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{t('select_device')}</option>
              {activeDevices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.code ? ` · ${device.code}` : ''}{device.warehouse ? ` — ${device.warehouse.name}` : ''}</option>)}
            </select>
            {activeDevices.length === 0 && <p className="text-xs text-warning">{t('no_device')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-shift">{t('work_shift')}</Label>
            <select id="session-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} required disabled={busy || activeShifts.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{t('work_shift')}</option>
              {activeShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}{shift.code ? ` · ${shift.code}` : ''}</option>)}
            </select>
            {activeShifts.length === 0 && <p className="text-xs text-warning">{locale === 'ar' ? 'لا توجد وردية نقاط بيع نشطة في هذا الفرع.' : 'No active POS shift is available in this branch.'}</p>}
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
        <form onSubmit={(e) => { e.preventDefault(); submitClose(); }} className="space-y-4">
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('close_reconciliation_hint')}</p>
          {closePreviewLoading && <p className="text-sm text-muted">{tc('loading')}</p>}
          {closePreview && <div className="overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 border-b border-border bg-surface-subtle px-3 py-2 text-xs font-medium text-muted">
              <span>{t('reconciliation_source')}</span><span className="text-end">{t('counted')}</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 border-b border-border px-3 py-2.5">
              <div className="min-w-0 text-sm"><p className="font-medium text-text">{t('cash_drawer')}</p>{closePreview.cash_drawer.expected_amount !== null && <p className="num text-xs text-muted">{t('expected')}: {formatRiyal(closePreview.cash_drawer.expected_amount)}</p>}</div>
              <Input id="cb" aria-label={t('counted')} className="num text-end" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            {closePreview.payment_methods.map((method) => method.payment_method_id && <div key={method.payment_method_id} className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 text-sm"><p className="truncate font-medium text-text">{method.payment_method_name}</p>{method.expected_amount !== null && <p className="num text-xs text-muted">{t('expected')}: {formatRiyal(method.expected_amount)}</p>}</div>
              <Input aria-label={`${t('counted')} — ${method.payment_method_name}`} className="num text-end" inputMode="decimal" value={paymentCounts[method.payment_method_id] ?? ''} onChange={(e) => setPaymentCounts((current) => ({ ...current, [method.payment_method_id as string]: e.target.value }))} required />
            </div>)}
          </div>}
          <div className="space-y-1.5">
            <Label htmlFor="handover-note">{t('handover_note')}</Label>
            <textarea id="handover-note" value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} placeholder={t('handover_note_placeholder')} required className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCloseId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || closePreviewLoading || !closePreview || !isValidRiyal(amount) || handoverNote.trim().length < 3 || closePreview.payment_methods.some((method) => Boolean(method.payment_method_id) && !isValidRiyal(paymentCounts[method.payment_method_id as string] ?? ''))}>{t('close_and_submit_handover')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!handoverSessionId} onClose={() => setHandoverSessionId(null)} title={t('confirm_handover_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitHandoverConfirmation(); }} className="space-y-4">
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-text">{t('confirm_handover_hint')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="handover-confirmation-note">{t('handover_confirmation_note')}</Label>
            <textarea id="handover-confirmation-note" value={handoverConfirmationNote} onChange={(e) => setHandoverConfirmationNote(e.target.value)} placeholder={t('handover_confirmation_note_placeholder')} required className="min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
          </div>
          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setHandoverSessionId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || handoverConfirmationNote.trim().length < 3}>{t('confirm_handover')}</Button>
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
