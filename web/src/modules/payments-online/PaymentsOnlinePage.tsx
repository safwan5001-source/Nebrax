'use client';

import Link from 'next/link';
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
import { EmptyState, PageHeader, Pagination } from '@/components/nebrax';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { api, hasApiStatus } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { formatDateTime } from '@/lib/formatting';
import { formatPayAmount } from '@/lib/pay-link';
import { useCan } from '@/lib/use-can';
import { apiErrorCode } from '@/modules/payments/gateways/contract';
import { AdjustmentsPanel } from '@/modules/payment-settlements/AdjustmentsPanel';
import { SettlementsPanel } from '@/modules/payment-settlements/SettlementsPanel';
import { RefundsPanel } from '@/modules/payment-refunds/RefundsPanel';
import { RequestRefundDialog } from '@/modules/payment-refunds/RequestRefundDialog';
import { ResolveExternalDialog } from '@/modules/payment-refunds/ResolveExternalDialog';
import { REQUEST_PERMISSION, RESOLVE_UNKNOWN_PERMISSION, VIEW_PERMISSION as REFUNDS_VIEW_PERMISSION } from '@/modules/payment-refunds/contract';
import {
  CAPTURE_STATUSES, REASON_MAX, canRequestRefund, RESOLVE_PERMISSION, VIEW_PERMISSION, blockedKind, buildListQuery, canRepost, knownRepostError, knownReviewReason,
  providerOutcomeTone, knownProviderOutcome, reasonValid, rowPhase, rowTone, type AttemptDetail, type AttemptRow, type ListMeta, type RepostResult, type TabKey, type TimelineEvent,
} from './contract';

/**
 * سجل الدفعات الإلكترونية (PAY-H2-03c): كل محاولات دفع الفواتير مع الحالة والمراجعة، وتبويب «المحجوبة بفترة مقفلة» وتبويب «تحتاج مراجعة»،
 * وتفصيل جانبي بخط زمني (إنشاء ← أحداث المزوّد ← التقاط ← ترحيل ← قرارات إعادة الترحيل). **قراءة** `payments.view`.
 * **إعادة الترحيل** (`payments.resolve_blocked`، owner/admin) قرار صريح بسبب ≥ ٥ أحرف؛ الخادم يرحّل عبر PaymentService فقط والنتيجة تظهر هنا كما رجعت
 * (قد تبقى «محجوبة» إن لم تُفتح الفترة بعد). لا إعادة ترحيل تلقائية ولا أثر محاسبي من هذه الشاشة نفسها.
 */
export function PaymentsOnlinePage() {
  const t = useTranslations('paymentsOnline');
  const locale = useLocale();
  const { can } = useCan();
  const demo = isDemo();
  const canView = can(VIEW_PERMISSION) && !demo;
  const canResolve = can(RESOLVE_PERMISSION);
  const canViewRefunds = can(REFUNDS_VIEW_PERMISSION);
  const canRequest = can(REQUEST_PERMISSION);
  const canResolveExternal = can(RESOLVE_UNKNOWN_PERMISSION);
  const tr = useTranslations('paymentRefunds');
  const ts = useTranslations('paymentSettlements');

  const [tab, setTab] = useState<TabKey>('all');
  const [captureStatus, setCaptureStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [repostFor, setRepostFor] = useState<AttemptRow | null>(null);
  const [section, setSection] = useState<'payments' | 'refunds' | 'settlements' | 'adjustments'>('payments');
  const [settlementsKey, setSettlementsKey] = useState(0);
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [refundsKey, setRefundsKey] = useState(0);

  // آخر طلب هو الحاسم: ردٌّ متأخر لاستعلام قديم (تبويب/مرشّح/صفحة تغيّرت) لا يكتب فوق الأحدث.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: AttemptRow[]; meta: ListMeta }>(`/payment-attempts?${buildListQuery({ tab, captureStatus, page, perPage })}`);
      if (mine !== latest.current) return;
      // صفحة خرجت عن النطاق (أُفرغت بإعادة ترحيل): ننتقل لآخر صفحة صالحة بدل ترك `page` غير صالح.
      if (res.data.length === 0 && res.meta.total > 0 && page > res.meta.last_page) {
        setPage(res.meta.last_page);
        return;
      }
      setRows(res.data);
      setMeta(res.meta);
      setLoading(false);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(hasApiStatus(e, 403) ? t('forbidden') : t('load_failed'));
      setLoading(false);
    }
  }, [tab, captureStatus, page, perPage, t]);

  const latestCount = useRef(0);
  const loadBlockedCount = useCallback(async () => {
    const mine = ++latestCount.current;
    try {
      const res = await api<{ meta: ListMeta }>('/payment-attempts?posting_status=blocked_period&per_page=1');
      if (mine === latestCount.current) setBlockedCount(res.meta.total);
    } catch {
      if (mine === latestCount.current) setBlockedCount(null);
    }
  }, []);

  useEffect(() => { if (canView) void load(); else setLoading(false); }, [canView, load]);
  useEffect(() => { if (canView) void loadBlockedCount(); }, [canView, loadBlockedCount]);

  const reviewLabel = useCallback((reason: string): string => {
    const key = knownReviewReason(reason);
    return key === 'other' ? reason : t(`review_${key}` as 'review_overpayment');
  }, [t]);

  const columns = useMemo<ColumnDef<AttemptRow, unknown>[]>(() => [
    {
      id: 'invoice', header: t('col_invoice'),
      cell: ({ row }) => row.original.invoice
        ? <Link href={`/invoices/${row.original.invoice.id}`} className="text-primary hover:underline"><bdi dir="ltr">{row.original.invoice.number ?? '—'}</bdi></Link>
        : '—',
    },
    {
      id: 'amount', header: t('col_amount'),
      cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.captured_minor > 0 ? row.original.captured_minor : row.original.amount_minor, row.original.currency)}</bdi>,
    },
    {
      id: 'status', header: t('col_status'),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={rowTone(r)}>{t(`phase_${rowPhase(r)}` as 'phase_none')}</Badge>
            {r.review_reasons.map((reason) => <Badge key={reason} tone="warning">{reviewLabel(reason)}</Badge>)}
            {r.unrecognized_refund && <Badge tone="warning">{tr('external_flag')}</Badge>}
          </div>
        );
      },
    },
    { id: 'gateway', header: t('col_gateway'), cell: ({ row }) => row.original.gateway?.name ?? '—' },
    { id: 'created', header: t('col_created'), cell: ({ row }) => <bdi>{row.original.created_at ? formatDateTime(row.original.created_at, locale) : '—'}</bdi> },
    {
      id: 'actions', header: () => <span className="sr-only">{t('col_actions')}</span>,
      cell: ({ row }) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDetailId(row.original.id)}>{t('action_details')}</Button>
          {canRepost(row.original, canResolve) && <Button size="sm" variant="outline" onClick={() => setRepostFor(row.original)}>{t('action_repost')}</Button>}
          {canRequestRefund(row.original, canRequest) && <Button size="sm" variant="outline" onClick={() => setRequestFor(row.original.id)}>{tr('action_request_refund')}</Button>}
        </div>
      ),
    },
  ], [t, tr, locale, canResolve, canRequest, reviewLabel]);

  const tabs: TabDef[] = [
    { id: 'all', label: t('tab_all') },
    { id: 'blocked', label: t('tab_blocked'), count: blockedCount ?? undefined, alert: (blockedCount ?? 0) > 0, alertLabel: t('tab_blocked_alert') },
    { id: 'review', label: t('tab_review') },
  ];

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <EmptyState title={demo ? t('demo_title') : t('forbidden')} description={demo ? t('demo_desc') : undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs
        tabs={[
          { id: 'payments', label: tr('section_payments') },
          ...(canViewRefunds ? [{ id: 'refunds', label: tr('section_refunds') }] : []),
          { id: 'settlements', label: ts('section_settlements') },
          { id: 'adjustments', label: ts('section_adjustments') },
        ]}
        value={section}
        onChange={(id) => setSection(id as typeof section)}
      />
      {section === 'settlements' ? (
        <SettlementsPanel refreshKey={settlementsKey} onChanged={() => { setSettlementsKey((k) => k + 1); setRefundsKey((k) => k + 1); void load(); }} />
      ) : section === 'adjustments' ? (
        <AdjustmentsPanel refreshKey={settlementsKey} onChanged={() => setSettlementsKey((k) => k + 1)} />
      ) : canViewRefunds && section === 'refunds' ? (
        <RefundsPanel refreshKey={refundsKey} onChanged={() => void load()} />
      ) : (
      <>
      <Tabs tabs={tabs} value={tab} onChange={(id) => { setTab(id as TabKey); setPage(1); }} />
      {tab === 'all' && (
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor="po-status">{t('filter_status')}</Label>
          <Select id="po-status" value={captureStatus} onChange={(e) => { setCaptureStatus(e.target.value); setPage(1); }}>
            <option value="">{t('filter_all')}</option>
            {CAPTURE_STATUSES.map((s) => <option key={s} value={s}>{t(`status_${s}` as 'status_created')}</option>)}
          </Select>
        </div>
      )}
      {tab === 'blocked' && <p className="text-sm leading-6 text-muted">{t('blocked_hint')}</p>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        showToolbar={false}
        error={error}
        onRetry={() => void load()}
        emptyLabel={t(`empty_${tab}` as 'empty_all')}
      />
      {meta && meta.total > 0 && (
        <Pagination page={meta.page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} />
      )}

      </>
      )}

      {detailId && <DetailSheet id={detailId} locale={locale} reviewLabel={reviewLabel} canResolveExternal={canResolveExternal} onResolveExternal={(attemptId) => { setDetailId(null); setResolveFor(attemptId); }} onClose={() => setDetailId(null)} />}
      {requestFor && (
        <RequestRefundDialog
          attemptId={requestFor}
          onClose={() => setRequestFor(null)}
          onDone={() => { setRequestFor(null); setRefundsKey((k) => k + 1); if (canViewRefunds) setSection('refunds'); }}
        />
      )}
      {resolveFor && (
        <ResolveExternalDialog
          attemptId={resolveFor}
          onClose={() => setResolveFor(null)}
          onDone={() => { setResolveFor(null); setDetailId(null); setRefundsKey((k) => k + 1); void load(); }}
        />
      )}
      {repostFor && (
        <RepostDialog
          row={repostFor}
          onClose={() => setRepostFor(null)}
          onDone={() => { setRepostFor(null); void load(); void loadBlockedCount(); }}
        />
      )}
    </div>
  );
}

function DetailSheet({ id, locale, reviewLabel, canResolveExternal, onResolveExternal, onClose }: {
  id: string; locale: string; reviewLabel: (r: string) => string; canResolveExternal: boolean; onResolveExternal: (attemptId: string) => void; onClose: () => void;
}) {
  const t = useTranslations('paymentsOnline');
  const tr = useTranslations('paymentRefunds');
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ data: AttemptDetail }>(`/payment-attempts/${id}`)
      .then((res) => { if (live) setDetail(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  function eventLabel(e: TimelineEvent): string {
    switch (e.type) {
      case 'provider_event': return `${t('ev_provider_event')}${e.event_type ? ` · ${e.event_type}` : ''}`;
      case 'repost': return e.outcome === 'posted' ? t('ev_repost_posted') : t('ev_repost_blocked');
      default: return t(`ev_${e.type}` as 'ev_created');
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('close')}>
        <div className="space-y-1 border-b border-border p-4">
          <SheetTitle className="text-base font-semibold">{t('detail_title')}</SheetTitle>
          <SheetDescription className="text-xs text-muted">{detail?.invoice?.number ? <bdi dir="ltr">{detail.invoice.number}</bdi> : t('detail_desc')}</SheetDescription>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {failed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
          {!failed && !detail && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={rowTone(detail)}>{t(`phase_${rowPhase(detail)}` as 'phase_none')}</Badge>
                {detail.review_reasons.map((r) => <Badge key={r} tone="warning">{reviewLabel(r)}</Badge>)}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label={t('col_amount')} value={<bdi dir="ltr">{formatPayAmount(detail.amount_minor, detail.currency)}</bdi>} />
                <Field label={t('field_captured')} value={<bdi dir="ltr">{formatPayAmount(detail.captured_minor, detail.currency)}</bdi>} />
                <Field label={t('col_gateway')} value={detail.gateway ? `${detail.gateway.name} · ${t(detail.gateway.environment === 'live' ? 'env_live' : 'env_sandbox')}` : '—'} />
                <Field label={t('field_accounting_date')} value={detail.accounting_date ? <bdi>{detail.accounting_date}</bdi> : '—'} />
              </dl>
              {detail.posting_status === 'blocked_period' && (
                <p role="note" className="rounded border border-negative/30 bg-negative/5 p-3 text-sm leading-6 text-negative">
                  {t(`blocked_${blockedKind(detail)}` as 'blocked_period')}
                </p>
              )}
              {detail.unrecognized_refund_at && (
                <div role="note" className="space-y-2 rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">
                  <p>{tr('external_flag_note', { amount: formatPayAmount(detail.unrecognized_refund_minor ?? 0, detail.currency) })}</p>
                  {canResolveExternal && <Button size="sm" variant="outline" onClick={() => onResolveExternal(detail.id)}>{tr('action_resolve_external')}</Button>}
                </div>
              )}
              {detail.refunded_minor > 0 && (
                <p className="text-sm text-muted">{tr('already_refunded')}: <bdi dir="ltr">{formatPayAmount(detail.refunded_minor, detail.currency)}</bdi></p>
              )}
              {detail.postings.length > 0 && (
                <section aria-labelledby="po-postings" className="space-y-2">
                  <h3 id="po-postings" className="text-sm font-semibold">{t('postings')}</h3>
                  <ul className="divide-y divide-border rounded border border-border text-sm">
                    {detail.postings.map((p) => (
                      <li key={p.payment_id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>{t(p.role === 'excess' ? 'posting_excess' : 'posting_allocated')} · <bdi dir="ltr">{p.payment_number ?? '—'}</bdi></span>
                        <bdi dir="ltr">{formatPayAmount(p.amount_minor, detail.currency)}</bdi>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-labelledby="po-timeline" className="space-y-2">
                <h3 id="po-timeline" className="text-sm font-semibold">{t('timeline')}</h3>
                <ol className="space-y-3 border-s border-border ps-4">
                  {detail.timeline.map((e, i) => (
                    <li key={`${e.type}-${i}`} className="relative text-sm">
                      <span aria-hidden className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                      <p className="flex flex-wrap items-center gap-1.5 font-medium">
                        {eventLabel(e)}
                        {e.type === 'provider_event' && (() => {
                          const outcome = knownProviderOutcome(e.outcome);
                          return outcome === null ? null : (
                            <Badge tone={providerOutcomeTone(outcome)}>{outcome === 'other' ? e.outcome : t(`outcome_${outcome}` as 'outcome_applied')}</Badge>
                          );
                        })()}
                      </p>
                      <p className="text-xs text-muted"><bdi>{e.at ? formatDateTime(e.at, locale) : '—'}</bdi></p>
                      {e.type === 'repost' && (
                        <p className="mt-0.5 text-xs leading-5 text-muted">{e.actor ? `${e.actor} — ` : ''}{e.reason}</p>
                      )}
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

function RepostDialog({ row, onClose, onDone }: { row: AttemptRow; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('paymentsOnline');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: RepostResult }>(`/payment-attempts/${row.id}/repost`, { method: 'POST', body: { reason: reason.trim() } });
      if (res.data.outcome === 'posted') toast.success(t('repost_posted'));
      else toast.error(t('repost_still_blocked'));
      onDone();
    } catch (e) {
      setError(t(`repost_error_${knownRepostError(apiErrorCode(e))}` as 'repost_error_unknown'));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t('repost_title')} onClose={onClose} closeLabel={t('close')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('repost_intro')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="po-reason">{t('repost_reason')}</Label>
          <Textarea id="po-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} aria-describedby="po-reason-hint" />
          <p id="po-reason-hint" className="text-xs text-muted">{t('repost_reason_hint')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('repost_cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || !reasonValid(reason)} aria-busy={saving}>{saving ? t('repost_saving') : t('repost_submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
