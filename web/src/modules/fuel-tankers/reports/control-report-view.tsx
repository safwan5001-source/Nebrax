'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/formatting';
import { litersOf, shortId } from '../fills/logic';
import { MinorAmount as Amount, TechnicalId } from '../fills/parts';
import { fillHref } from '../fills/routes';
import { isKnownFinding, type ControlReport, type ControlRow, type ReportMeta } from './logic';
import { BalanceScopeNotice, FindingBadges, MaskingNotice, ResultBadge, RowScopeNotice, StateBadge, SummaryTiles, TruncatedNotice } from './parts';
import { ResultFilterSelect, type ResultFilter } from './result-filter';

/**
 * ④ الرقابة المحاسبية: سلسلة التتبع لكل سند — السند ← حركة المخزن ← حركة التكلفة ← القيد ← الدفتر التشغيلي (← العكس) — ونتيجة المطابقة **مؤكَّد فرق / تنبيه / لم تكتمل**.
 * ملخص الحساب الوسيط يظهر **فقط** إن أعلن الخادم `clearing.available`؛ غير ذلك يُشرح السبب دون أي رصيد (مستخدم مقيَّد بمحطة/مخزن أو بلا الصلاحيتين المالية).
 */
export function ControlReportView({ data, meta }: { data: ControlReport; meta: ReportMeta }) {
  const t = useTranslations('fuelTankerReports');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const rows = useMemo(() => (filter === 'all' ? data.rows : data.rows.filter((row) => row.result === filter)), [data.rows, filter]);
  const s = data.summary;

  return (
    <div className="space-y-3" data-report-view="accounting-control">
      <RowScopeNotice meta={meta} />
      {data.truncated ? <TruncatedNotice limit={meta.scan_limit} /> : null}
      <MaskingNotice costs={data.masking.costs} accounts={data.masking.accounts} />
      <SummaryTiles tiles={[
        { key: 'total', label: t('summary.total'), value: s.total },
        { key: 'matched', label: t('result.matched'), value: s.matched, tone: 'positive' },
        { key: 'mismatch', label: t('summary.confirmedDifferences'), value: s.confirmed_differences, tone: s.confirmed_differences > 0 ? 'negative' : undefined },
        { key: 'warning', label: t('summary.warnings'), value: s.warnings, tone: s.warnings > 0 ? 'warning' : undefined },
        { key: 'incomplete', label: t('summary.incomplete'), value: s.incomplete },
      ]} />

      <ClearingSummary data={data} meta={meta} />

      {s.findings_by_code.length > 0 ? (
        <Card data-findings-by-code="">
          <CardHeader><CardTitle>{t('control.findingsTitle')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {s.findings_by_code.map((f) => (
                <li key={f.code}>
                  <Badge tone={f.severity === 'error' ? 'negative' : f.severity === 'warning' ? 'warning' : 'muted'} wrap data-finding={f.code} data-severity={f.severity}>
                    {isKnownFinding(f.code) ? t(`finding.${f.code}`) : t('finding.unknown', { code: f.code })} ({f.count})
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ResultFilterSelect value={filter} onChange={setFilter} />
      <p className="text-xs text-muted" data-result-filter-note="">{t('resultFilter.note', { shown: rows.length, loaded: data.rows.length })}</p>

      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={data.rows.length === 0 ? t('empty.title') : t('resultFilter.noMatch')} description={data.rows.length === 0 ? t('empty.body') : t('resultFilter.noMatchHint')} />
      ) : (
        <ul className="space-y-2">{rows.map((row) => <li key={row.fill_id}><TraceRow row={row} /></li>)}</ul>
      )}
    </div>
  );
}

function ClearingSummary({ data, meta }: { data: ControlReport; meta: ReportMeta }) {
  const t = useTranslations('fuelTankerReports');
  const clearing = data.clearing;
  if (!clearing.available) {
    const reason = clearing.reason === 'station_scope_restricted' || clearing.reason === 'financial_permissions_required' ? clearing.reason : 'unknown';
    return (
      <div role="note" className="flex items-start gap-2 rounded-md border border-border bg-primary-soft px-3 py-2 text-sm" data-clearing-unavailable={reason}>
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-text">{t('control.clearingUnavailableTitle')}</p>
          <p>{t(`control.clearingUnavailable.${reason}`)}</p>
        </div>
      </div>
    );
  }
  return (
    <Card data-clearing-summary="">
      <CardHeader><CardTitle>{t('control.clearingTitle')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {clearing.scope ? <BalanceScopeNotice scope={clearing.scope} notApplicable={meta.balance_filters_not_applicable} /> : null}
        {clearing.period ? <p className="text-sm text-muted">{t('clearing.period', { from: clearing.period.from ?? '—', to: clearing.period.to ?? '—' })}</p> : null}
        {clearing.accounts.length === 0 ? <p className="text-sm text-muted">{t('clearing.emptyBody')}</p> : (
          <ul className="space-y-2">
            {clearing.accounts.map((a) => (
              <li key={a.account.id} className="space-y-1.5 rounded-md border border-border p-3 text-sm" data-clearing-account={a.account.code ?? a.account.id}>
                <p className="font-semibold text-text"><span className="num" dir="ltr">{a.account.code ?? '—'}</span> <bdi>{a.account.name ?? ''}</bdi></p>
                <dl className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted">{t('clearing.balance.closing')}</dt><dd className="font-medium"><Amount minor={a.closing_balance_minor} /></dd></div>
                  <div><dt className="text-xs text-muted">{t('clearing.balance.supported')}</dt><dd className="font-medium"><Amount minor={a.supported_balance_minor} /></dd></div>
                  <div><dt className="text-xs text-muted">{t('clearing.balance.difference')}</dt><dd className={`font-medium ${a.unexplained_difference_minor !== 0 ? 'text-negative' : ''}`}><Amount minor={a.unexplained_difference_minor} /></dd></div>
                </dl>
                <FindingBadges findings={a.findings} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TraceRow({ row }: { row: ControlRow }) {
  const t = useTranslations('fuelTankerReports');
  const locale = useLocale();
  const q = row.quantities;
  const chain = row.chain;
  const reversed = row.posting_status === 'reversed';
  return (
    <details className="rounded-md border border-border bg-surface" data-report-row="" data-result={row.result} open={row.result === 'mismatch'}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
        <bdi className="num font-medium text-text" dir="ltr">{row.number}</bdi>
        <StateBadge status={row.inventory_status} />
        <ResultBadge result={row.result} />
        {row.findings.length > 0 ? <span className="text-xs text-muted">{t('control.findingsCount', { count: row.findings.length })}</span> : null}
        <span className="ms-auto num text-xs text-muted" dir="ltr">{litersOf(row.quantity_milliliters)} {t('liters')}</span>
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
        <p className="text-xs text-muted">
          {row.voucher_number ? <>{t('control.voucher')}: <bdi className="num" dir="ltr">{row.voucher_number}</bdi> · </> : null}
          {row.owner_name ? <><bdi>{row.owner_name}</bdi> · </> : null}
          {row.recorded_at ? <span className="num">{formatDateTime(row.recorded_at, locale)}</span> : null}
        </p>
        <ol className="space-y-2" data-trace="" aria-label={t('control.traceLabel')}>
          <Step n={1} stepKey="fill" title={t('control.step.fill')}>
            <span className="num" dir="ltr">{litersOf(q.fill ?? row.quantity_milliliters)}</span> {t('liters')}
          </Step>
          <Step n={2} stepKey="stock" title={t('control.step.stock')} missing={row.posting_status !== null && q.stock_out === null} detail={chain?.stock_movement_id}>
            <span className="num" dir="ltr">{litersOf(q.stock_out ?? null)}</span>{row.values ? <> · <Amount minor={row.values.stock_total_cost_minor} /></> : null}
          </Step>
          <Step n={3} stepKey="cost" title={t('control.step.cost')} missing={row.posting_status !== null && q.cost_issue === null} detail={chain?.cost_movement_id}>
            <span className="num" dir="ltr">{litersOf(q.cost_issue ?? null)}</span>{row.values ? <> · <Amount minor={row.values.cost_movement_minor} /></> : null}
          </Step>
          <Step n={4} stepKey="entry" title={t('control.step.entry')} missing={row.posting_status !== null && chain !== null && chain.journal_entry === null}>
            {chain?.journal_entry ? <><bdi className="num" dir="ltr">{chain.journal_entry.number ?? shortId(chain.journal_entry.id)}</bdi>{chain.journal_entry.status ? <> · <span className="text-muted">{chain.journal_entry.status}</span></> : null}{row.values ? <> · <Amount minor={row.values.entry_debit_minor} /></> : null}</> : chain === null && row.posting_status !== null ? <span className="text-muted">{t('control.step.hiddenNoCost')}</span> : '—'}
            {row.accounts ? (
              <span className="mt-0.5 block text-xs text-muted" data-accounts="">{t('control.step.accounts')}: <TechnicalId value={row.accounts.clearing_account_id} /> ← <TechnicalId value={row.accounts.inventory_account_id} /></span>
            ) : null}
          </Step>
          <Step n={5} stepKey="ledger" title={t('control.step.ledger')} missing={row.posting_status !== null && q.ledger === null}>
            <span className="num" dir="ltr">{litersOf(q.ledger ?? null)}</span>{row.values ? <> · <Amount minor={row.values.ledger_value_minor} /></> : null}
          </Step>
          {reversed ? (
            <Step n={6} stepKey="reversal" title={t('control.step.reversal')} missing={q.stock_reversal_in === null || q.cost_reversal === null || q.ledger_reversal === null || (chain !== null && chain.reversal_journal_entry === null)}>
              <span className="num" dir="ltr">{litersOf(q.stock_reversal_in ?? null)}</span>
              {chain?.reversal_journal_entry ? <> · <bdi className="num" dir="ltr">{chain.reversal_journal_entry.number ?? shortId(chain.reversal_journal_entry.id)}</bdi></> : null}
              {row.values ? <> · <Amount minor={row.values.reversal_entry_debit_minor} /></> : null}
            </Step>
          ) : null}
        </ol>
        {row.findings.length > 0 ? <FindingBadges findings={row.findings} /> : null}
        <Link href={fillHref(row.fill_id)} className="inline-flex min-h-11 items-center text-primary hover:underline" data-open-fill="">{t('control.openFill')}</Link>
      </div>
    </details>
  );
}

function Step({ n, stepKey, title, missing = false, detail, children }: { n: number; stepKey: string; title: string; missing?: boolean; detail?: string | null; children: React.ReactNode }) {
  const t = useTranslations('fuelTankerReports');
  return (
    <li className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${missing ? 'border-negative/50' : 'border-border'}`} data-step={stepKey} data-missing={missing ? 'true' : 'false'}>
      <span aria-hidden="true" className="num mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs text-primary">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{title}{missing ? <> · <span className="text-negative">{t('control.missing')}</span></> : null}</p>
        <div className="text-sm text-text">{children}</div>
        {detail ? <p className="text-xs text-muted"><TechnicalId value={detail} /></p> : null}
      </div>
    </li>
  );
}
