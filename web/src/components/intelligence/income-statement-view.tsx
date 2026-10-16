'use client';

import { useTranslations } from 'next-intl';
import { Money } from '@/components/ui/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { IncomeStatementResult, StatementLine } from '@/modules/intelligence/contract';
import { KpiTile, toneOf } from './kpi-tile';

function Lines({ title, lines, total, totalLabel }: { title: string; lines: StatementLine[]; total: string; totalLabel: string }) {
  const t = useTranslations('intelligence.result');
  return (
    <section className="overflow-hidden rounded border border-border bg-surface" aria-label={title}>
      <Table aria-label={title}>
        <THead>
          <TR className="bg-background/60">
            <TH scope="col" className="w-20 text-xs">{t('code')}</TH>
            <TH scope="col" className="text-xs">{title}</TH>
            <TH scope="col" className="text-end text-xs">{t('amount')}</TH>
          </TR>
        </THead>
        <TBody>
          {lines.length === 0 ? (
            <TR><TD colSpan={3} className="text-center text-muted">{t('no_lines')}</TD></TR>
          ) : lines.map((line) => (
            <TR key={`${line.code}-${line.name}`}>
              <TD className="py-1.5"><span dir="ltr" className="font-mono text-xs text-muted">{line.code}</span></TD>
              <TD className="py-1.5">{line.name}</TD>
              <TD className="py-1.5 text-end"><Money value={line.amount.decimal} /></TD>
            </TR>
          ))}
          <TR className="bg-primary-soft/40 font-semibold">
            <TD />
            <TD>{totalLabel}</TD>
            <TD className="text-end"><Money value={total} /></TD>
          </TR>
        </TBody>
      </Table>
    </section>
  );
}

/**
 * قائمة الدخل: الخلاصة أولاً (ثلاثة أرقام رئيسية كما أرسلها الخادم) ثم الجدولان بكثافة عالية.
 * لا نِسَب ولا نمو ولا مقارنات: لا توجد في الخدمة، فلا تُحسب هنا.
 */
export function IncomeStatementView({ result }: { result: IncomeStatementResult }) {
  const t = useTranslations('intelligence.result');
  const { totals } = result;
  return (
    <div className="space-y-4" data-result="income_statement">
      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={t('summary')}>
        <KpiTile emphasis className="sm:order-first" label={t('net_income')} value={totals.net_income.decimal} tone={toneOf(totals.net_income.minor)} />
        <KpiTile label={t('total_revenue')} value={totals.total_revenue.decimal} tone="positive" />
        <KpiTile label={t('total_expense')} value={totals.total_expense.decimal} tone="negative" />
      </div>

      <Lines title={t('revenues')} lines={result.revenues} total={totals.total_revenue.decimal} totalLabel={t('total_revenue')} />
      <Lines title={t('expenses')} lines={result.expenses} total={totals.total_expense.decimal} totalLabel={t('total_expense')} />

      {result.unallocated ? (
        <div className={cn('rounded border border-border bg-surface px-3 py-2 text-xs text-muted')}>
          <p className="mb-1">{t('unallocated')}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>{t('total_revenue')}: <Money value={result.unallocated.total_revenue.decimal} /></span>
            <span>{t('total_expense')}: <Money value={result.unallocated.total_expense.decimal} /></span>
            <span>{t('net_income')}: <Money value={result.unallocated.net_income.decimal} /></span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
