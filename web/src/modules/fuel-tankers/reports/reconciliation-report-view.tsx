'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { EmptyState, MobileRecordItem } from '@/components/nebrax';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { litersOf } from '../fills/logic';
import { MinorAmount } from '../fills/parts';
import { fillHref } from '../fills/routes';
import { ReconciliationView } from '../inventory/reconciliation-panel';
import { readReconciliation } from '../inventory/logic';
import type { ReconciliationReport, ReconRow, ReportMeta } from './logic';
import { FindingBadges, MaskingNotice, ResultBadge, RowScopeNotice, StateBadge, SummaryTiles, TruncatedNotice } from './parts';
import { ResultFilterSelect, type ResultFilter } from './result-filter';

const QUANTITY_COLUMNS = ['fill', 'stock_out', 'cost_issue', 'ledger'] as const;
const REVERSAL_COLUMNS = ['stock_reversal_in', 'cost_reversal', 'ledger_reversal'] as const;
const VALUE_COLUMNS = ['posting_cost_minor', 'stock_total_cost_minor', 'cost_movement_minor', 'entry_debit_minor', 'ledger_value_minor'] as const;

/**
 * ② مطابقة المخزون: سند التعبئة ↔ حركة المخزن ↔ مجمّع التكلفة ↔ الدفتر التشغيلي (والعكس). الصف «متطابق» لا يُعلَن إلا إن أعلنه الخادم.
 * أسفلها مطابقة **مستوى المجمّع** بالعرض نفسه الموجود في مراجعة الدمج (`ReconciliationView`) — لا نسخة ثانية.
 */
export function ReconciliationReportView({ data, meta }: { data: ReconciliationReport; meta: ReportMeta }) {
  const t = useTranslations('fuelTankerReports');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const rows = useMemo(() => (filter === 'all' ? data.rows : data.rows.filter((row) => row.result === filter)), [data.rows, filter]);
  const pool = useMemo(() => readReconciliation({ data: data.pool }), [data.pool]);
  const s = data.summary;
  const totals = s.quantity_totals;

  return (
    <div className="space-y-3" data-report-view="inventory-reconciliation">
      <RowScopeNotice meta={meta} />
      {data.truncated ? <TruncatedNotice limit={meta.scan_limit} /> : null}
      <MaskingNotice costs={data.masking.costs} />
      <SummaryTiles tiles={[
        { key: 'total', label: t('summary.total'), value: s.total },
        { key: 'matched', label: t('result.matched'), value: s.matched, tone: 'positive' },
        { key: 'mismatch', label: t('summary.confirmedDifferences'), value: s.confirmed_differences, tone: s.confirmed_differences > 0 ? 'negative' : undefined },
        { key: 'warning', label: t('summary.warnings'), value: s.warnings, tone: s.warnings > 0 ? 'warning' : undefined },
        { key: 'incomplete', label: t('summary.incomplete'), value: s.incomplete },
      ]} />
      <Card data-quantity-totals="">
        <CardHeader><CardTitle>{t('reconciliation.totalsTitle')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {(['fills_posted_milliliters', 'stock_out_milliliters', 'cost_issue_milliliters', 'ledger_milliliters', 'reversed_milliliters'] as const).map((key) => (
              <div key={key}><dt className="text-xs text-muted">{t(`reconciliation.totals.${key}`)}</dt><dd className="num font-medium text-text" dir="ltr">{litersOf(totals[key] ?? 0)}</dd></div>
            ))}
          </dl>
          {data.truncated ? <p className="mt-2 text-xs text-warning">{t('reconciliation.totalsLimited')}</p> : null}
        </CardContent>
      </Card>

      <ResultFilterSelect value={filter} onChange={setFilter} />
      <p className="text-xs text-muted" data-result-filter-note="">{t('resultFilter.note', { shown: rows.length, loaded: data.rows.length })}</p>

      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={data.rows.length === 0 ? t('empty.title') : t('resultFilter.noMatch')} description={data.rows.length === 0 ? t('empty.body') : t('resultFilter.noMatchHint')} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded border border-border bg-surface md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t('column.fill')}</TH><TH>{t('column.state')}</TH>
                  {QUANTITY_COLUMNS.map((c) => <TH key={c}>{t(`quantity.${c}`)}</TH>)}
                  <TH>{t('column.result')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => <ReconTableRow key={row.fill_id} row={row} costsMasked={data.masking.costs} />)}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-border rounded border border-border bg-surface md:hidden">
            {rows.map((row) => (
              <li key={row.fill_id} data-report-row="" data-result={row.result}>
                <Link href={fillHref(row.fill_id)} className="block active:bg-primary-soft max-md:min-h-11">
                  <MobileRecordItem record={{
                    title: <bdi className="num" dir="ltr">{row.number}</bdi>,
                    subtitle: row.voucher_number ?? undefined,
                    amount: `${litersOf(row.quantities.fill ?? null)} ${t('liters')}`,
                    status: <><StateBadge status={row.inventory_status} /><ResultBadge result={row.result} /></>,
                  }} />
                </Link>
                <div className="space-y-1.5 px-3.5 pb-3">
                  <QuantityList row={row} />
                  <FindingBadges findings={row.findings} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <section data-pool-reconciliation="" className="space-y-2">
        <div><h2 className="text-base font-semibold text-text">{t('reconciliation.poolTitle')}</h2><p className="text-sm text-muted">{t('reconciliation.poolHint')}</p></div>
        <ReconciliationView data={pool} />
      </section>
    </div>
  );
}

function ReconTableRow({ row, costsMasked }: { row: ReconRow; costsMasked: boolean }) {
  return (
    <TR data-report-row="" data-result={row.result}>
      <TD className="font-medium align-top">
        <Link href={fillHref(row.fill_id)} className="text-primary hover:underline"><bdi className="num" dir="ltr">{row.number}</bdi></Link>
        {row.voucher_number ? <span className="block text-xs text-muted"><bdi className="num" dir="ltr">{row.voucher_number}</bdi></span> : null}
      </TD>
      <TD className="align-top"><StateBadge status={row.inventory_status} /></TD>
      {QUANTITY_COLUMNS.map((c) => <TD key={c} className="align-top"><span className="num" dir="ltr" data-quantity={c}>{litersOf(row.quantities[c] ?? null)}</span></TD>)}
      <TD className="space-y-1.5 align-top"><ResultBadge result={row.result} /><FindingBadges findings={row.findings} />{costsMasked ? null : <ValuesLine row={row} />}</TD>
    </TR>
  );
}

function QuantityList({ row }: { row: ReconRow }) {
  const t = useTranslations('fuelTankerReports');
  const entries = [...QUANTITY_COLUMNS, ...REVERSAL_COLUMNS].filter((c) => row.quantities[c] !== undefined && row.quantities[c] !== null);
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {entries.map((c) => <div key={c} className="flex justify-between gap-2"><dt className="text-muted">{t(`quantity.${c}`)}</dt><dd className="num" dir="ltr">{litersOf(row.quantities[c] ?? null)}</dd></div>)}
      {row.values ? VALUE_COLUMNS.filter((c) => row.values?.[c] !== undefined && row.values?.[c] !== null).map((c) => (
        <div key={c} className="flex justify-between gap-2"><dt className="text-muted">{t(`value.${c}`)}</dt><dd><MinorAmount minor={row.values?.[c]} /></dd></div>
      )) : null}
    </dl>
  );
}

function ValuesLine({ row }: { row: ReconRow }) {
  const t = useTranslations('fuelTankerReports');
  if (!row.values) return null;
  const present = VALUE_COLUMNS.filter((c) => row.values?.[c] !== undefined && row.values?.[c] !== null);
  if (present.length === 0) return null;
  return (
    <details className="text-xs" data-values="">
      <summary className="min-h-8 cursor-pointer text-muted">{t('column.values')}</summary>
      <dl className="mt-1 space-y-0.5">{present.map((c) => <div key={c} className="flex justify-between gap-3"><dt className="text-muted">{t(`value.${c}`)}</dt><dd><MinorAmount minor={row.values?.[c]} /></dd></div>)}</dl>
    </details>
  );
}
