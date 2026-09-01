'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { ArrowRight, BookOpenCheck, ClipboardCheck, History, LockKeyhole, ReceiptText, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/formatting';
import { formatRiyal, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Reconciliation {
  id: string;
  reconciliation_key: string;
  payment_method_name: string | null;
  settlement_type: string;
  expected_amount: string;
  counted_amount: string;
  difference: string;
  count_source: string;
}

interface Session {
  id: string;
  number: string;
  status: 'open' | 'closed';
  handover_status: 'pending' | 'confirmed' | null;
  opening_balance: string;
  expected_balance: string | null;
  closing_balance: string | null;
  difference: string | null;
  difference_status: 'pending' | 'acknowledged' | 'not_required' | null;
  variance_type: 'shortage' | 'overage' | null;
  variance_journal_entry_id: string | null;
  difference_acknowledgement: { acknowledged_at: string; note: string | null } | null;
  opened_at: string | null;
  closed_at: string | null;
  handover_note: string | null;
  handover_submitted_at: string | null;
  handover_confirmed_at: string | null;
  handover_confirmation_note: string | null;
  handover_receiver?: { id: string; name: string } | null;
  pos_device?: { id: string; name: string; code: string | null } | null;
  warehouse?: { id: string; name: string; code: string | null } | null;
  pos_shift?: { id: string; name: string; code: string | null } | null;
  shift?: { id: string; name: string } | null;
  reconciliations: Reconciliation[];
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

interface CashMovement {
  id: string;
  type: 'cash_in' | 'cash_out';
  amount: string;
  reason: string;
  recorded_at: string | null;
  recorded_by_user?: { id: string; name: string } | null;
}

interface SessionEvent {
  id: string;
  type: string;
  amount: string | null;
  reason_note: string | null;
  created_at: string | null;
  actor?: { id: string; name: string } | null;
}

export default function PosSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations('posSessions');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [action, setAction] = useState<'acknowledge' | 'handover' | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [canAcknowledgeDifference, setCanAcknowledgeDifference] = useState(false);
  const [canConfirmHandover, setCanConfirmHandover] = useState(false);
  const [canViewAccounts, setCanViewAccounts] = useState(false);

  const formatDate = useCallback(
    (value: string | null) => formatDateTime(value, locale),
    [locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailResult, reportResult, movementResult, eventResult] = await Promise.all([
        api<{ data: Session }>(`/pos-sessions/${id}`),
        api<{ session: Session; report: SessionReport }>(`/pos-sessions/${id}/report`),
        api<{ data: CashMovement[] }>(`/pos-sessions/${id}/cash-movements`),
        api<{ data: SessionEvent[] }>(`/pos-sessions/${id}/events`),
      ]);
      setSession(detailResult.data);
      setReport(reportResult.report);
      setMovements(movementResult.data);
      setEvents(eventResult.data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tc('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, tc]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const apply = (permissions: string[] | undefined) => {
      setCanAcknowledgeDifference(Boolean(permissions?.includes('*') || permissions?.includes('pos.variance.approve')));
      setCanConfirmHandover(Boolean(permissions?.includes('*') || permissions?.includes('pos.session.handover.confirm')));
      setCanViewAccounts(Boolean(permissions?.includes('*') || permissions?.includes('accounts.view')));
    };
    const user = currentUser();
    if (user?.permissions !== undefined) apply(user.permissions);
    else api<{ user: { permissions?: string[] } }>('/me').then((result) => apply(result.user.permissions)).catch(() => {});
  }, []);

  const eventLabels = useMemo<Record<string, string>>(() => ({
    cash_in_recorded: t('event_cash_in_recorded'),
    cash_out_recorded: t('event_cash_out_recorded'),
    return_recorded: t('event_return_recorded'),
    exchange_recorded: t('event_exchange_recorded'),
    closing_difference_requires_acknowledgement: t('event_closing_difference_requires_acknowledgement'),
    closing_difference_acknowledged: t('event_closing_difference_acknowledged'),
    closing_difference_settled: t('event_closing_difference_settled'),
    session_handover_submitted: t('event_handover_submitted'),
    session_handover_confirmed: t('event_handover_confirmed'),
  }), [t]);

  async function submitNoteAction() {
    if (!action || actionNote.trim().length < 3) return;
    setBusy(true);
    setActionError(null);
    try {
      const endpoint = action === 'acknowledge' ? 'acknowledge-difference' : 'confirm-handover';
      await api(`/pos-sessions/${id}/${endpoint}`, { method: 'POST', body: { note: actionNote.trim() } });
      success(action === 'acknowledge' ? t('difference_acknowledged_success') : t('handover_confirmed_success'));
      setAction(null);
      setActionNote('');
      await load();
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function settleVariance() {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/pos-sessions/${id}/settle-variance`, { method: 'POST' });
      success(t('variance_settled_success'));
      await load();
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-28 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }

  if (error || !session) {
    return <div className="rounded-md border border-border bg-surface p-8 text-center"><p role="alert" className="text-sm text-negative">{error ?? t('detail_not_found')}</p><Button variant="outline" className="mt-3" onClick={() => void load()}>{t('retry')}</Button></div>;
  }

  const status = session.status === 'open'
    ? { label: t('open_status'), tone: 'warning' as const }
    : session.difference_status === 'pending'
      ? { label: t('difference_pending'), tone: 'warning' as const }
      : session.handover_status === 'pending'
        ? { label: t('handover_pending'), tone: 'warning' as const }
        : session.handover_status === 'confirmed'
          ? { label: t('handover_confirmed'), tone: 'positive' as const }
          : { label: t('closed_status'), tone: 'neutral' as const };

  const figures = [
    [t('opening_balance'), session.opening_balance],
    [t('expected'), session.expected_balance],
    [t('closing_balance'), session.closing_balance],
    [t('difference'), session.difference],
  ] as const;

  const reportRows = report ? [
    [t('cash_sales'), report.cash_sales], [t('cash_refunds'), report.cash_refunds],
    [t('cash_in_total'), report.cash_in], [t('cash_out_total'), report.cash_out],
    [t('returns_total'), report.returns_total], [t('net_sales'), report.net_sales],
    [t('average'), report.average], [t('expected'), report.expected],
  ] : [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/pos/sessions" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />{t('back_to_sessions')}
        </Link>
        <div className="flex flex-wrap items-center gap-2"><h1 className="num text-xl font-semibold text-text">{session.number}</h1><Badge tone={status.tone}>{status.label}</Badge></div>
        <p className="mt-1 text-sm text-muted">{t('detail_subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {session.status === 'open' && <Button asChild variant="outline"><Link href="/pos/sessions"><LockKeyhole className="h-4 w-4" strokeWidth={1.7} />{t('manage_session')}</Link></Button>}
        {session.status === 'closed' && session.difference_status === 'pending' && <Button variant="outline" disabled={!canAcknowledgeDifference || busy} title={!canAcknowledgeDifference ? t('approver_only') : undefined} onClick={() => { setAction('acknowledge'); setActionNote(''); setActionError(null); }}><ClipboardCheck className="h-4 w-4" strokeWidth={1.7} />{t('acknowledge_difference')}</Button>}
        {session.status === 'closed' && session.difference_status === 'acknowledged' && !session.variance_journal_entry_id && <Button variant="outline" disabled={!canAcknowledgeDifference || busy} title={!canAcknowledgeDifference ? t('approver_only') : undefined} onClick={() => void settleVariance()}><BookOpenCheck className="h-4 w-4" strokeWidth={1.7} />{t('settle_variance')}</Button>}
        {session.status === 'closed' && session.handover_status === 'pending' && <Button variant="outline" disabled={!canConfirmHandover || session.difference_status === 'pending' || busy} title={!canConfirmHandover ? t('handover_approver_only') : session.difference_status === 'pending' ? t('handover_resolve_variance_first') : undefined} onClick={() => { setAction('handover'); setActionNote(''); setActionError(null); }}><ShieldCheck className="h-4 w-4" strokeWidth={1.7} />{t('confirm_handover')}</Button>}
        <Button variant="outline" onClick={() => void load()}>{t('refresh')}</Button>
      </div>
    </div>
    {actionError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{actionError}</p>}

    <section aria-label={t('financial_summary')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {figures.map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted">{label}</p><p className={cn('num mt-1 text-lg font-semibold text-text', label === t('difference') && value !== null && isNegative(value) && 'text-negative')}>{value === null ? '—' : formatRiyal(value)}</p></CardContent></Card>)}
    </section>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpenCheck className="h-4 w-4 text-muted" strokeWidth={1.7} />{t('reconciliation_title')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {session.reconciliations.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">{t('reconciliation_empty')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-border bg-surface-subtle text-xs text-muted"><tr><th className="px-4 py-2 text-start font-medium">{t('reconciliation_source')}</th><th className="px-4 py-2 text-end font-medium">{t('expected')}</th><th className="px-4 py-2 text-end font-medium">{t('closing_balance')}</th><th className="px-4 py-2 text-end font-medium">{t('difference')}</th><th className="px-4 py-2 text-start font-medium">{t('count_source')}</th></tr></thead><tbody>{session.reconciliations.map((row) => <tr key={row.id} className="border-b border-border last:border-b-0"><td className="px-4 py-2.5 font-medium text-text">{row.reconciliation_key === 'cash_drawer' ? t('cash_drawer') : row.payment_method_name ?? '—'}</td><td className="num px-4 py-2.5 text-end">{formatRiyal(row.expected_amount)}</td><td className="num px-4 py-2.5 text-end">{formatRiyal(row.counted_amount)}</td><td className={cn('num px-4 py-2.5 text-end', isNegative(row.difference) && 'text-negative')}>{formatRiyal(row.difference)}</td><td className="px-4 py-2.5 text-muted">{row.count_source === 'operator' ? t('count_source_operator') : t('count_source_system')}</td></tr>)}</tbody></table></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ReceiptText className="h-4 w-4 text-muted" strokeWidth={1.7} />{t('report_title')}</CardTitle></CardHeader>
          <CardContent><div className="grid gap-x-6 sm:grid-cols-2">{reportRows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm"><span className="text-muted">{label}</span><span className="num font-medium text-text">{formatRiyal(value)}</span></div>)}</div>{report && <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm"><span className="text-muted">{t('sales_count')}: <strong className="num text-text">{report.sales_count}</strong></span><span className="text-muted">{t('returns_count')}: <strong className="num text-text">{report.returns_count}</strong></span></div>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('cash_movements_title')}</CardTitle></CardHeader>
          <CardContent className="p-0">{movements.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">{t('cash_movements_empty')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="border-y border-border bg-surface-subtle text-xs text-muted"><tr><th className="px-4 py-2 text-start font-medium">{t('cash_movement')}</th><th className="px-4 py-2 text-end font-medium">{t('cash_movement_amount')}</th><th className="px-4 py-2 text-start font-medium">{t('cash_movement_reason')}</th><th className="px-4 py-2 text-start font-medium">{t('recorded_at')}</th></tr></thead><tbody>{movements.map((row) => <tr key={row.id} className="border-b border-border last:border-b-0"><td className="px-4 py-2.5">{row.type === 'cash_in' ? t('cash_in') : t('cash_out')}</td><td className="num px-4 py-2.5 text-end">{formatRiyal(row.amount)}</td><td className="px-4 py-2.5 text-text">{row.reason}</td><td className="px-4 py-2.5 text-muted">{formatDate(row.recorded_at)}</td></tr>)}</tbody></table></div>}</CardContent>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">{t('operational_details')}</CardTitle></CardHeader><CardContent><dl className="space-y-2.5 text-sm">{[
          [t('device'), session.pos_device ? `${session.pos_device.name}${session.pos_device.code ? ` · ${session.pos_device.code}` : ''}` : '—'],
          [t('work_shift'), session.pos_shift ? `${session.pos_shift.name}${session.pos_shift.code ? ` · ${session.pos_shift.code}` : ''}` : session.shift?.name ?? '—'],
          [t('warehouse'), session.warehouse ? `${session.warehouse.name}${session.warehouse.code ? ` · ${session.warehouse.code}` : ''}` : '—'],
          [t('opened_at'), formatDate(session.opened_at)], [t('closed_at'), formatDate(session.closed_at)],
        ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b border-border pb-2.5 last:border-b-0"><dt className="text-muted">{label}</dt><dd className="text-end text-text">{value}</dd></div>)}</dl></CardContent></Card>

        <Card><CardHeader><CardTitle className="text-base">{t('handover_and_variance')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <div><p className="text-xs text-muted">{t('handover_note')}</p><p className="mt-1 whitespace-pre-wrap text-text">{session.handover_note || '—'}</p></div>
          <div><p className="text-xs text-muted">{t('handover_confirmation_note')}</p><p className="mt-1 whitespace-pre-wrap text-text">{session.handover_confirmation_note || '—'}</p></div>
          {session.handover_receiver && <div><p className="text-xs text-muted">{t('handover_receiver')}</p><p className="mt-1 text-text">{session.handover_receiver.name} · {formatDate(session.handover_confirmed_at)}</p></div>}
          {session.difference_acknowledgement && <div><p className="text-xs text-muted">{t('acknowledgement_note')}</p><p className="mt-1 whitespace-pre-wrap text-text">{session.difference_acknowledgement.note || '—'}</p><p className="mt-1 text-xs text-muted">{formatDate(session.difference_acknowledgement.acknowledged_at)}</p></div>}
          {session.variance_journal_entry_id && canViewAccounts && <Link href={`/journal-entries/${session.variance_journal_entry_id}`} className="inline-flex text-primary hover:underline">{t('view_variance_journal')}</Link>}
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-muted" strokeWidth={1.7} />{t('audit_log')}</CardTitle></CardHeader><CardContent>{events.length === 0 ? <p className="text-sm text-muted">{t('audit_empty')}</p> : <ol className="space-y-0">{events.map((event) => <li key={event.id} className="relative border-s border-border pb-4 ps-4 last:border-transparent last:pb-0"><span className="absolute -start-1 top-1 h-2 w-2 rounded-full bg-primary" /><p className="text-sm font-medium text-text">{eventLabels[event.type] ?? event.type.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs text-muted">{event.actor?.name ?? '—'} · {formatDate(event.created_at)}</p>{event.reason_note && <p className="mt-1 text-xs text-text">{event.reason_note}</p>}{event.amount && <p className="num mt-1 text-xs text-text">{formatRiyal(event.amount)}</p>}</li>)}</ol>}</CardContent></Card>
      </aside>
    </div>

    <Dialog open={action !== null} onClose={() => setAction(null)} title={action === 'acknowledge' ? t('acknowledge_difference_title') : t('confirm_handover_title')}>
      <form onSubmit={(event) => { event.preventDefault(); void submitNoteAction(); }} className="space-y-3">
        <p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{action === 'acknowledge' ? t('acknowledge_difference_hint') : t('confirm_handover_hint')}</p>
        <label htmlFor="session-action-note" className="text-sm font-medium text-text">{action === 'acknowledge' ? t('acknowledgement_note') : t('handover_confirmation_note')}</label>
        <textarea id="session-action-note" value={actionNote} onChange={(event) => setActionNote(event.target.value)} className="min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" placeholder={action === 'acknowledge' ? t('acknowledgement_note_placeholder') : t('handover_confirmation_note_placeholder')} required />
        {actionError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{actionError}</p>}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setAction(null)}>{t('cancel')}</Button><Button type="submit" disabled={busy || actionNote.trim().length < 3}>{action === 'acknowledge' ? t('acknowledge_difference') : t('confirm_handover')}</Button></div>
      </form>
    </Dialog>
  </div>;
}
