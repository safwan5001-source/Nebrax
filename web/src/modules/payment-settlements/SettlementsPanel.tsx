'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax';
import { api, hasApiStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { formatPayAmount } from '@/lib/pay-link';
import { useCan } from '@/lib/use-can';
import { gatewayDisplayName } from '@/modules/payments/gateways/contract';
import { MANAGE_PERMISSION, VIEW_REFUNDS_PERMISSION, buildListQuery, differenceTone, settlementTone, type ListMeta, type SettlementDetail, type SettlementRow } from './contract';
import { formatSigned } from './format';
import { RecordSettlementDialog } from './RecordSettlementDialog';
import { useGateways } from './useGateways';

/**
 * تسويات البوابة (PAY-H3-02d): قائمة مرقَّمة بمرشّح الاتصال، شارة `مرحَّلة / غير مطابقة` (الفرق الموقَّع للمسودة ظاهر)، وتفصيل بالبنود والاستردادات والتعديلات،
 * وتسجيل تسوية بمعاينة حيّة (`RecordSettlementDialog`). الخادم حاسم: القيد يولّده عند الترحيل فقط، والمسودة غير المطابقة لا أثر محاسبياً لها.
 */
export function SettlementsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const t = useTranslations('paymentSettlements');
  const locale = useLocale();
  const { can } = useCan();
  const canManage = can(MANAGE_PERMISSION);
  const { gateways } = useGateways();

  const [gatewayId, setGatewayId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: SettlementRow[]; meta: ListMeta }>(`/payment-gateway-settlements?${buildListQuery({ page, perPage, gatewayId })}`);
      if (mine !== latest.current) return;
      setRows(res.data);
      setMeta(res.meta);
      setLoading(false);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(hasApiStatus(e, 403) ? t('forbidden') : t('load_failed'));
      setLoading(false);
    }
  }, [page, perPage, gatewayId, t]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const columns = useMemo<ColumnDef<SettlementRow, unknown>[]>(() => [
    { id: 'ref', header: t('col_ref'), cell: ({ row }) => <bdi dir="ltr" className="font-medium">{row.original.provider_settlement_ref}</bdi> },
    { id: 'gateway', header: t('col_gateway'), cell: ({ row }) => row.original.gateway_name ?? '—' },
    { id: 'date', header: t('col_date'), cell: ({ row }) => <bdi>{row.original.settlement_date ?? '—'}</bdi> },
    { id: 'gross', header: t('col_gross'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.gross_amount, row.original.currency)}</bdi> },
    { id: 'net', header: t('col_net'), cell: ({ row }) => <bdi dir="ltr">{formatPayAmount(row.original.net_bank_amount, row.original.currency)}</bdi> },
    {
      id: 'status', header: t('col_status'),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={settlementTone(row.original.status)}>{t(`status_${row.original.status}` as 'status_posted')}</Badge>
          {row.original.status === 'unreconciled' && row.original.unreconciled_minor !== null && (
            <Badge tone={differenceTone(row.original.unreconciled_minor)}>
              <bdi dir="ltr">{formatSigned(row.original.unreconciled_minor, row.original.currency)}</bdi>
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">{t('col_actions')}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDetailId(row.original.id)}>{t('action_details')}</Button>
        </div>
      ),
    },
  ], [t]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('panel_hint')}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-xs flex-1 flex-col gap-1.5">
          <Label htmlFor="ps-gateway">{t('filter_gateway')}</Label>
          <Select id="ps-gateway" value={gatewayId} onChange={(e) => { setGatewayId(e.target.value); setPage(1); }}>
            <option value="">{t('filter_all')}</option>
            {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
          </Select>
        </div>
        {canManage && <Button onClick={() => setRecording(true)}>{t('record_open')}</Button>}
      </div>
      <DataTable columns={columns} data={rows} loading={loading} showToolbar={false} error={error} onRetry={() => void load()} emptyLabel={t('empty')} />
      {meta && meta.total > 0 && (
        <Pagination page={meta.page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} />
      )}
      {detailId && <SettlementDetailSheet id={detailId} locale={locale} onClose={() => setDetailId(null)} />}
      {recording && (
        <RecordSettlementDialog
          gateways={gateways}
          onClose={() => setRecording(false)}
          onDone={() => { setRecording(false); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function SettlementDetailSheet({ id, locale, onClose }: { id: string; locale: string; onClose: () => void }) {
  const t = useTranslations('paymentSettlements');
  const { can } = useCan();
  const seesRefunds = can(VIEW_REFUNDS_PERMISSION);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ data: SettlementDetail }>(`/payment-gateway-settlements/${id}`)
      .then((res) => { if (live) setDetail(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  const money = (minor: number) => (detail ? <bdi dir="ltr">{formatPayAmount(minor, detail.currency)}</bdi> : null);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('close')}>
        <div className="space-y-1 border-b border-border p-4">
          <SheetTitle className="text-base font-semibold">{t('detail_title')}</SheetTitle>
          <SheetDescription className="text-xs text-muted">{detail ? <bdi dir="ltr">{detail.provider_settlement_ref}</bdi> : t('detail_desc')}</SheetDescription>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {failed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
          {!failed && !detail && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={settlementTone(detail.status)}>{t(`status_${detail.status}` as 'status_posted')}</Badge>
                {detail.status === 'unreconciled' && detail.unreconciled_minor !== null && (
                  <Badge tone={differenceTone(detail.unreconciled_minor)}><bdi dir="ltr">{formatSigned(detail.unreconciled_minor, detail.currency)}</bdi></Badge>
                )}
              </div>
              {detail.status === 'unreconciled' && <p role="note" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">{t('unreconciled_note')}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label={t('col_gateway')} value={detail.gateway_name ?? '—'} />
                <Field label={t('col_date')} value={<bdi>{detail.settlement_date ?? '—'}</bdi>} />
                <Field label={t('col_gross')} value={money(detail.gross_amount)} />
                <Field label={t('field_refunds_total')} value={money(detail.refunds_total)} />
                <Field label={t('field_fee')} value={money(detail.provider_fee_ex_tax)} />
                <Field label={t('field_fee_tax')} value={money(detail.provider_fee_tax)} />
                <Field label={t('field_deductions')} value={money(detail.provider_deductions)} />
                <Field label={t('field_credits')} value={money(detail.provider_credits)} />
                <Field label={t('col_net')} value={money(detail.net_bank_amount)} />
                <Field label={t('field_posted_at')} value={detail.posted_at ? <bdi>{formatDateTime(detail.posted_at, locale)}</bdi> : '—'} />
                <Field label={t('field_journal_entry')} value={detail.journal_entry_id ? <bdi dir="ltr">{detail.journal_entry_id.slice(0, 8)}</bdi> : '—'} />
              </dl>
              <section aria-labelledby="ps-items" className="space-y-2">
                <h3 id="ps-items" className="text-sm font-semibold">{t('items_title')}</h3>
                <ul className="divide-y divide-border rounded border border-border text-sm">
                  {detail.items.map((i) => (
                    <li key={i.payment_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate"><bdi dir="ltr">{i.provider_event_ref ?? i.payment_id.slice(0, 8)}</bdi></span>
                      {money(i.gross_amount)}
                    </li>
                  ))}
                  {detail.items.length === 0 && <li className="px-3 py-2 text-muted">{t('items_none')}</li>}
                </ul>
              </section>
              {detail.lines.length > 0 && (
                <section aria-labelledby="ps-lines" className="space-y-2">
                  <h3 id="ps-lines" className="text-sm font-semibold">{t('lines_title')}</h3>
                  <ul className="divide-y divide-border rounded border border-border text-sm">
                    {detail.lines.map((l, i) => (
                      <li key={`${l.line_type}-${l.adjustment_id ?? l.payment_refund_id ?? i}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="min-w-0">
                          <span className="font-medium">{t.has(`line_${l.line_type}` as 'line_refund') ? t(`line_${l.line_type}` as 'line_refund') : l.line_type}</span>
                          {l.line_type === 'refund' && seesRefunds && l.refund_number && <> · <bdi dir="ltr">{l.refund_number}</bdi></>}
                          {l.evidence_ref && <span className="block truncate text-xs text-muted">{t('evidence')}: <bdi dir="ltr">{l.evidence_ref}</bdi></span>}
                        </span>
                        {money(l.amount_minor)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
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
