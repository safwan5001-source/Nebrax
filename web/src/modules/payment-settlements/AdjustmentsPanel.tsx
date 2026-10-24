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
import { api, hasApiStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { formatPayAmount } from '@/lib/pay-link';
import { useCan, useCurrentUser } from '@/lib/use-can';
import { apiErrorCode, gatewayDisplayName } from '@/modules/payments/gateways/contract';
import {
  ADJUSTMENT_KINDS, ADJUSTMENT_STATUSES, ADJUST_PERMISSION, APPROVE_ADJUSTMENT_PERMISSION, REASON_MAX, adjustmentTone, buildListQuery, canApproveAdjustment,
  canCancelAdjustment, knownError, reasonValid, type AdjustmentDetail, type AdjustmentRow, type ListMeta, type ReserveBalance,
} from './contract';
import { RequestAdjustmentDialog } from './RequestAdjustmentDialog';
import { useGateways } from './useGateways';

type ReasonKind = 'reject' | 'cancel';

/**
 * تعديلات المزوّد (PAY-H3-02d، ADR-0008 D-22): احتياطي محتجز/مُفرج عنه وتعديلات مدينة/دائنة بدليل إلزامي. **الطلب لا يحرّك مالاً**: يحتاج اعتماداً من مستخدم آخر
 * (الطالب لا يعتمد طلبه — يفرضه الخادم والقاعدة)، ثم يُستهلك بتسوية مرحَّلة. رصيد الاحتياطي (المحتجز/القابل للإفراج) يُقرأ من الخادم لكل اتصال.
 */
export function AdjustmentsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const t = useTranslations('paymentAdjustments');
  const locale = useLocale();
  const { can } = useCan();
  const me = useCurrentUser();
  const toast = useToast();
  const canRequest = can(ADJUST_PERMISSION);
  const canApprove = can(APPROVE_ADJUSTMENT_PERMISSION);
  const { gateways } = useGateways();

  const [gatewayId, setGatewayId] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ kind: ReasonKind; row: AdjustmentRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reserve, setReserve] = useState<ReserveBalance | null>(null);
  const [reserveFailed, setReserveFailed] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: AdjustmentRow[]; meta: ListMeta }>(`/payment-gateway-adjustments?${buildListQuery({ page, perPage, gatewayId, status, kind })}`);
      if (mine !== latest.current) return;
      setRows(res.data);
      setMeta(res.meta);
      setLoading(false);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(hasApiStatus(e, 403) ? t('forbidden') : t('load_failed'));
      setLoading(false);
    }
  }, [page, perPage, gatewayId, status, kind, t]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // رصيد الاحتياطي لاتصال واحد محدَّد (لا تجميع عبر اتصالات): يُحدَّث بعد كل تغيير في القائمة.
  useEffect(() => {
    setReserve(null);
    setReserveFailed(false);
    if (!gatewayId) return;
    let live = true;
    api<{ data: ReserveBalance }>(`/payment-gateways/${gatewayId}/reserve-balance`)
      .then((res) => { if (live) setReserve(res.data); })
      .catch(() => { if (live) setReserveFailed(true); });
    return () => { live = false; };
  }, [gatewayId, refreshKey, rows]);

  async function approve(row: AdjustmentRow) {
    setBusyId(row.id);
    try {
      await api(`/payment-gateway-adjustments/${row.id}/approve`, { method: 'POST' });
      toast.success(t('done_approve'));
      await load();
      onChanged();
    } catch (e) {
      toast.error(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const columns = useMemo<ColumnDef<AdjustmentRow, unknown>[]>(() => [
    { id: 'kind', header: t('col_kind'), cell: ({ row }) => t(`kind_${row.original.kind}` as 'kind_reserve_hold') },
    { id: 'amount', header: t('col_amount'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.amount_minor, row.original.currency)}</bdi> },
    { id: 'evidence', header: t('col_evidence'), cell: ({ row }) => <bdi dir="ltr">{row.original.evidence_ref}</bdi> },
    { id: 'status', header: t('col_status'), cell: ({ row }) => <Badge tone={adjustmentTone(row.original.status)}>{t(`status_${row.original.status}` as 'status_requested')}</Badge> },
    { id: 'requested', header: t('col_requested'), cell: ({ row }) => <span>{row.original.requested_by?.name ?? '—'}<br /><bdi className="text-xs text-muted">{row.original.requested_at ? formatDateTime(row.original.requested_at, locale) : '—'}</bdi></span> },
    {
      id: 'actions', header: () => <span className="sr-only">{t('col_actions')}</span>,
      cell: ({ row }) => {
        const r = row.original;
        const busy = busyId === r.id;
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>{t('action_details')}</Button>
            {canApproveAdjustment(r, canApprove, me?.id ?? null) && (
              <>
                <Button size="sm" disabled={busy} onClick={() => void approve(r)}>{t('action_approve')}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setReasonFor({ kind: 'reject', row: r })}>{t('action_reject')}</Button>
              </>
            )}
            {canCancelAdjustment(r, canApprove, me?.id ?? null) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReasonFor({ kind: 'cancel', row: r })}>{t('action_cancel')}</Button>}
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, locale, canApprove, me?.id, busyId]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('panel_hint')}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor="pa-gateway">{t('filter_gateway')}</Label>
            <Select id="pa-gateway" value={gatewayId} onChange={(e) => { setGatewayId(e.target.value); setPage(1); }}>
              <option value="">{t('filter_all')}</option>
              {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
            </Select>
          </div>
          <div className="flex min-w-36 flex-col gap-1.5">
            <Label htmlFor="pa-status">{t('filter_status')}</Label>
            <Select id="pa-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">{t('filter_all')}</option>
              {ADJUSTMENT_STATUSES.map((s) => <option key={s} value={s}>{t(`status_${s}` as 'status_requested')}</option>)}
            </Select>
          </div>
          <div className="flex min-w-36 flex-col gap-1.5">
            <Label htmlFor="pa-kind">{t('filter_kind')}</Label>
            <Select id="pa-kind" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              <option value="">{t('filter_all')}</option>
              {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}` as 'kind_reserve_hold')}</option>)}
            </Select>
          </div>
        </div>
        {canRequest && <Button onClick={() => setRequesting(true)}>{t('request_open')}</Button>}
      </div>
      {gatewayId !== '' && (
        <section aria-label={t('reserve_title')} className="grid grid-cols-2 gap-3 rounded border border-border p-3 text-sm" data-testid="pa-reserve">
          {reserveFailed ? <p role="alert" className="col-span-2 text-negative">{t('reserve_failed')}</p> : (
            <>
              <div><p className="text-xs text-muted">{t('reserve_held')}</p><p className="font-medium">{reserve ? <bdi dir="ltr">{formatPayAmount(reserve.held_minor, 'SAR')}</bdi> : '…'}</p></div>
              <div><p className="text-xs text-muted">{t('reserve_releasable')}</p><p className="font-medium">{reserve ? <bdi dir="ltr">{formatPayAmount(reserve.releasable_minor, 'SAR')}</bdi> : '…'}</p></div>
              <p className="col-span-2 text-xs leading-5 text-muted">{t('reserve_note')}</p>
            </>
          )}
        </section>
      )}
      <DataTable columns={columns} data={rows} loading={loading} showToolbar={false} error={error} onRetry={() => void load()} emptyLabel={t('empty')} />
      {meta && meta.total > 0 && (
        <Pagination page={meta.page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} />
      )}
      {detailId && <AdjustmentDetailSheet id={detailId} locale={locale} onClose={() => setDetailId(null)} />}
      {requesting && (
        <RequestAdjustmentDialog
          gateways={gateways}
          defaultGatewayId={gatewayId}
          onClose={() => setRequesting(false)}
          onDone={() => { setRequesting(false); void load(); onChanged(); }}
        />
      )}
      {reasonFor && (
        <ReasonDialog
          kind={reasonFor.kind}
          row={reasonFor.row}
          onClose={() => setReasonFor(null)}
          onDone={() => { setReasonFor(null); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function ReasonDialog({ kind, row, onClose, onDone }: { kind: ReasonKind; row: AdjustmentRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('paymentAdjustments');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api(`/payment-gateway-adjustments/${row.id}/${kind}`, { method: 'POST', body: { reason: reason.trim() } });
      toast.success(t(`done_${kind}` as 'done_reject'));
      onDone();
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t(`dialog_${kind}_title` as 'dialog_reject_title')} onClose={() => { if (!saving) onClose(); }} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t(`dialog_${kind}_intro` as 'dialog_reject_intro')} <bdi dir="ltr">{row.evidence_ref}</bdi></p>
        <div className="space-y-1.5">
          <Label htmlFor="pa-reason">{t('reason')}</Label>
          <Textarea id="pa-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} aria-describedby="pa-reason-hint" />
          <p id="pa-reason-hint" className="text-xs text-muted">{t('reason_hint')}</p>
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

function AdjustmentDetailSheet({ id, locale, onClose }: { id: string; locale: string; onClose: () => void }) {
  const t = useTranslations('paymentAdjustments');
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ data: AdjustmentDetail }>(`/payment-gateway-adjustments/${id}`)
      .then((res) => { if (live) setDetail(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('close')}>
        <div className="space-y-1 border-b border-border p-4">
          <SheetTitle className="text-base font-semibold">{t('detail_title')}</SheetTitle>
          <SheetDescription className="text-xs text-muted">{detail ? t(`kind_${detail.kind}` as 'kind_reserve_hold') : t('detail_desc')}</SheetDescription>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {failed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
          {!failed && !detail && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
          {detail && (
            <>
              <Badge tone={adjustmentTone(detail.status)}>{t(`status_${detail.status}` as 'status_requested')}</Badge>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label={t('col_amount')} value={<bdi dir="ltr">{formatPayAmount(detail.amount_minor, detail.currency)}</bdi>} />
                <Field label={t('col_evidence')} value={<bdi dir="ltr">{detail.evidence_ref}</bdi>} />
                <Field label={t('field_requested_by')} value={detail.requested_by?.name ?? '—'} />
                <Field label={t('field_approved_by')} value={detail.approved_by?.name ?? '—'} />
                <Field label={t('field_event_ref')} value={detail.provider_event_ref ? <bdi dir="ltr">{detail.provider_event_ref}</bdi> : '—'} />
                <Field label={t('field_settlement')} value={detail.settlement_id ? <bdi dir="ltr">{detail.settlement_id.slice(0, 8)}</bdi> : '—'} />
              </dl>
              <p className="text-sm leading-6">{detail.reason}</p>
              {detail.reject_reason && <p className="text-sm text-muted">{t('field_reject_reason')}: {detail.reject_reason}</p>}
              {detail.cancel_reason && <p className="text-sm text-muted">{t('field_cancel_reason')}: {detail.cancel_reason}</p>}
              <section aria-labelledby="pa-timeline" className="space-y-2">
                <h3 id="pa-timeline" className="text-sm font-semibold">{t('timeline')}</h3>
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
