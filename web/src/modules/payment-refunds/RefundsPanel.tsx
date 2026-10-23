'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { api, hasApiStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { formatPayAmount } from '@/lib/pay-link';
import { useCan, useCurrentUser } from '@/lib/use-can';
import { apiErrorCode } from '@/modules/payments/gateways/contract';
import {
  APPROVE_PERMISSION, REASON_MAX, REPOST_PERMISSION, RESOLVE_UNKNOWN_PERMISSION, buildListQuery, canCancel, canDecide, canRepost, canResolve, canSubmit, inTab, knownError,
  reasonValid, statusTone, type ListMeta, type RefundDetail, type RefundRow, type RefundTab,
} from './contract';

type ActionKind = 'reject' | 'cancel' | 'resolve_confirm' | 'resolve_not_applied' | 'repost';

/**
 * استردادات البوابة (PAY-H3-01e): قائمة بتبويبات (الكل · بانتظار الإجراء · تحتاج تدخلاً) وتفصيل بخط زمني. الإجراءات حسب الصلاحية والحالة:
 * **اعتماد/رفض** (لغير الطالب)، **إرسال** بعد الاعتماد، **إلغاء**، **حسم غير المعروف** (تأكيد بدليل / لم يُطبَّق)، **إعادة ترحيل** المحجوب بفترة مقفلة.
 * الخادم هو الحاسم؛ ردوده (409/422) تُترجَم بالرمز الثابت. لا أثر محاسبي من الواجهة نفسها: القيد يولّده الخادم عند التأكيد.
 */
export function RefundsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const t = useTranslations('paymentRefunds');
  const locale = useLocale();
  const { can } = useCan();
  const me = useCurrentUser();
  const toast = useToast();
  const canApprove = can(APPROVE_PERMISSION);
  const canResolveUnknown = can(RESOLVE_UNKNOWN_PERMISSION);
  const canRepostBlocked = can(REPOST_PERMISSION);

  const [tab, setTab] = useState<RefundTab>('all');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: ActionKind; row: RefundRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const q = buildListQuery({ tab, page, perPage }) + (status ? `&status=${status}` : '');
      const res = await api<{ data: RefundRow[]; meta: ListMeta }>(`/payment-refunds?${q}`);
      if (mine !== latest.current) return;
      setRows(res.data);
      setMeta(res.meta);
      setLoading(false);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(hasApiStatus(e, 403) ? t('forbidden') : t('load_failed'));
      setLoading(false);
    }
  }, [tab, page, perPage, status, t]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const visible = useMemo(() => rows.filter((r) => inTab(r, tab)), [rows, tab]);

  async function run(path: string, row: RefundRow, body?: Record<string, unknown>, success?: string) {
    setBusyId(row.id);
    try {
      await api(`/payment-refunds/${row.id}/${path}`, { method: 'POST', body });
      if (success) toast.success(success);
      await load();
      onChanged();
    } catch (e) {
      toast.error(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const columns = useMemo<ColumnDef<RefundRow, unknown>[]>(() => [
    { id: 'number', header: t('col_number'), cell: ({ row }) => <bdi dir="ltr" className="font-medium">{row.original.number}</bdi> },
    { id: 'partner', header: t('col_partner'), cell: ({ row }) => row.original.partner_name ?? '—' },
    { id: 'amount', header: t('col_amount'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.amount_minor, row.original.currency)}</bdi> },
    {
      id: 'status', header: t('col_status'),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={statusTone(row.original.status, row.original.posting_status)}>{t(`status_${row.original.status}` as 'status_requested')}</Badge>
          {row.original.status === 'confirmed' && row.original.posting_status && (
            <Badge tone={row.original.posting_status === 'blocked_period' ? 'warning' : 'muted'}>{t(`posting_${row.original.posting_status}` as 'posting_pending')}</Badge>
          )}
        </div>
      ),
    },
    { id: 'requested', header: t('col_requested'), cell: ({ row }) => <span>{row.original.requested_by.name ?? '—'}<br /><bdi className="text-xs text-muted">{row.original.requested_at ? formatDateTime(row.original.requested_at, locale) : '—'}</bdi></span> },
    {
      id: 'actions', header: () => <span className="sr-only">{t('col_actions')}</span>,
      cell: ({ row }) => {
        const r = row.original;
        const busy = busyId === r.id;
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>{t('action_details')}</Button>
            {canDecide(r, canApprove, me?.id ?? null) && (
              <>
                <Button size="sm" disabled={busy} onClick={() => void run('approve', r, { submit: true }, t('approved_and_sent'))}>{t('action_approve_send')}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setAction({ kind: 'reject', row: r })}>{t('action_reject')}</Button>
              </>
            )}
            {canSubmit(r, canApprove) && <Button size="sm" disabled={busy} onClick={() => void run('submit', r, undefined, t('sent'))}>{t('action_send')}</Button>}
            {canCancel(r, canApprove, me?.id ?? null) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAction({ kind: 'cancel', row: r })}>{t('action_cancel')}</Button>}
            {canResolve(r, canResolveUnknown) && (
              <>
                <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'resolve_confirm', row: r })}>{t('action_resolve_confirm')}</Button>
                <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'resolve_not_applied', row: r })}>{t('action_resolve_not_applied')}</Button>
              </>
            )}
            {canRepost(r, canRepostBlocked) && <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'repost', row: r })}>{t('action_repost')}</Button>}
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, locale, canApprove, canResolveUnknown, canRepostBlocked, me?.id, busyId]);

  const tabs: TabDef[] = [
    { id: 'all', label: t('tab_all') },
    { id: 'pending', label: t('tab_pending') },
    { id: 'attention', label: t('tab_attention') },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('panel_hint')}</p>
      <Tabs tabs={tabs} value={tab} onChange={(id) => { setTab(id as RefundTab); setPage(1); }} />
      {tab === 'all' && (
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor="rf-status">{t('filter_status')}</Label>
          <Select id="rf-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('filter_all')}</option>
            {(['requested', 'approved', 'confirmed', 'failed', 'unknown', 'rejected', 'cancelled'] as const).map((s) => <option key={s} value={s}>{t(`status_${s}` as 'status_requested')}</option>)}
          </Select>
        </div>
      )}
      <DataTable columns={columns} data={visible} loading={loading} showToolbar={false} error={error} onRetry={() => void load()} emptyLabel={t(`empty_${tab}` as 'empty_all')} />
      {meta && meta.total > 0 && (
        <Pagination page={meta.page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} />
      )}
      {detailId && <RefundDetailSheet id={detailId} locale={locale} onClose={() => setDetailId(null)} />}
      {action && (
        <ReasonDialog
          kind={action.kind}
          row={action.row}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}

const ACTION_PATH: Record<ActionKind, string> = { reject: 'reject', cancel: 'cancel', resolve_confirm: 'resolve', resolve_not_applied: 'resolve', repost: 'repost' };

function ReasonDialog({ kind, row, onClose, onDone }: { kind: ActionKind; row: RefundRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('paymentRefunds');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (kind === 'resolve_confirm') body.decision = 'confirm';
      if (kind === 'resolve_not_applied') body.decision = 'not_applied';
      await api(`/payment-refunds/${row.id}/${ACTION_PATH[kind]}`, { method: 'POST', body });
      toast.success(t(`done_${kind}` as 'done_reject'));
      onDone();
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t(`dialog_${kind}_title` as 'dialog_reject_title')} onClose={onClose} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">
          {t(`dialog_${kind}_intro` as 'dialog_reject_intro')} <bdi dir="ltr">{row.number}</bdi>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="rf-reason">{t('reason')}</Label>
          <Textarea id="rf-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} aria-describedby="rf-reason-hint" />
          <p id="rf-reason-hint" className="text-xs text-muted">{t('reason_hint')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || !reasonValid(reason)} aria-busy={saving}>{saving ? t('saving') : t(`dialog_${kind}_submit` as 'dialog_reject_submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RefundDetailSheet({ id, locale, onClose }: { id: string; locale: string; onClose: () => void }) {
  const t = useTranslations('paymentRefunds');
  const [detail, setDetail] = useState<RefundDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ data: RefundDetail }>(`/payment-refunds/${id}`)
      .then((res) => { if (live) setDetail(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('close')}>
        <div className="space-y-1 border-b border-border p-4">
          <SheetTitle className="text-base font-semibold">{t('detail_title')}</SheetTitle>
          <SheetDescription className="text-xs text-muted">{detail ? <bdi dir="ltr">{detail.number}</bdi> : t('detail_desc')}</SheetDescription>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {failed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
          {!failed && !detail && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone(detail.status, detail.posting_status)}>{t(`status_${detail.status}` as 'status_requested')}</Badge>
                {detail.status === 'confirmed' && detail.posting_status && <Badge tone={detail.posting_status === 'blocked_period' ? 'warning' : 'muted'}>{t(`posting_${detail.posting_status}` as 'posting_pending')}</Badge>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label={t('col_amount')} value={<bdi dir="ltr">{formatPayAmount(detail.amount_minor, detail.currency)}</bdi>} />
                <Field label={t('col_partner')} value={detail.partner_name ?? '—'} />
                <Field label={t('field_requested_by')} value={detail.requested_by.name ?? '—'} />
                <Field label={t('field_approved_by')} value={detail.approved_by?.name ?? '—'} />
                <Field label={t('field_accounting_date')} value={detail.accounting_date ? <bdi>{detail.accounting_date}</bdi> : '—'} />
                <Field label={t('field_provider_ref')} value={detail.provider_refund_ref ? <bdi dir="ltr">{detail.provider_refund_ref}</bdi> : '—'} />
              </dl>
              {detail.posting_status === 'blocked_period' && <p role="note" className="rounded border border-negative/30 bg-negative/5 p-3 text-sm leading-6 text-negative">{t('blocked_note')}</p>}
              {detail.excess_minor > 0 && <p role="note" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">{t('excess_note', { amount: formatPayAmount(detail.excess_minor, detail.currency) })}</p>}
              {detail.status === 'unknown' && <p role="note" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">{t('unknown_note')}</p>}
              {detail.reject_reason && <p className="text-sm text-muted">{t('field_reject_reason')}: {detail.reject_reason}</p>}
              {detail.cancel_reason && <p className="text-sm text-muted">{t('field_cancel_reason')}: {detail.cancel_reason}</p>}
              <section aria-labelledby="rf-allocs" className="space-y-2">
                <h3 id="rf-allocs" className="text-sm font-semibold">{t('allocation')}</h3>
                <ul className="divide-y divide-border rounded border border-border text-sm">
                  {detail.allocations.map((a) => (
                    <li key={a.source_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>{t(a.source_type === 'credit_note' ? 'source_credit_note' : 'source_sales_return')} · <bdi dir="ltr">{a.source_number ?? '—'}</bdi></span>
                      <bdi dir="ltr">{formatPayAmount(a.amount_minor, detail.currency)}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="rf-timeline" className="space-y-2">
                <h3 id="rf-timeline" className="text-sm font-semibold">{t('timeline')}</h3>
                <ol className="space-y-3 border-s border-border ps-4">
                  {detail.timeline.map((e, i) => (
                    <li key={`${e.action}-${i}`} className="relative text-sm">
                      <span aria-hidden className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                      <p className="font-medium">{t.has(`ev_${e.action}` as 'ev_requested') ? t(`ev_${e.action}` as 'ev_requested') : e.action}</p>
                      <p className="text-xs text-muted"><bdi>{e.at ? formatDateTime(e.at, locale) : '—'}</bdi>{e.actor ? ` · ${e.actor}` : ''}</p>
                      {e.reason && <p className="mt-0.5 text-xs leading-5 text-muted">{e.reason}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
