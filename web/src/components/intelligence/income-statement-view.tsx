'use client';

import { useTranslations } from 'next-intl';
import { Money } from '@/components/ui/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { IncomeStatementResult, StatementLine } from '@/modules/intelligence/contract';

function Lines({ title, lines }: { title: string; lines: StatementLine[] }) {
  const t = useTranslations('intelligence.result');
  return (
    <Table aria-label={title}>
      <THead>
        <TR>
          <TH scope="col" className="w-24">{t('code')}</TH>
          <TH scope="col">{title}</TH>
          <TH scope="col" className="text-end">{t('amount')}</TH>
        </TR>
      </THead>
      <TBody>
        {lines.length === 0 ? (
          <TR><TD colSpan={3} className="text-center text-muted">{t('no_lines')}</TD></TR>
        ) : lines.map((line) => (
          <TR key={`${line.code}-${line.name}`}>
            <TD><span dir="ltr" className="font-mono text-xs text-muted">{line.code}</span></TD>
            <TD>{line.name}</TD>
            <TD className="text-end"><Money value={line.amount.decimal} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-t border-border px-3 py-2', strong && 'bg-primary-soft/50')}>
      <span className={cn('text-sm', strong ? 'font-semibold text-text' : 'text-muted')}>{label}</span>
      <Money value={value} className={cn(strong ? 'text-base font-semibold' : 'text-sm')} />
    </div>
  );
}

/** قائمة الدخل: جدولان مضغوطان وإجماليات من الخادم — الواجهة لا تجمع ولا تطرح شيئاً. */
export function IncomeStatementView({ result }: { result: IncomeStatementResult }) {
  const t = useTranslations('intelligence.result');
  return (
    <div className="space-y-4" data-result="income_statement">
      <div className="overflow-hidden rounded border border-border bg-surface">
        <Lines title={t('revenues')} lines={result.revenues} />
        <Total label={t('total_revenue')} value={result.totals.total_revenue.decimal} />
      </div>
      <div className="overflow-hidden rounded border border-border bg-surface">
        <Lines title={t('expenses')} lines={result.expenses} />
        <Total label={t('total_expense')} value={result.totals.total_expense.decimal} />
      </div>
      <div className="overflow-hidden rounded border border-border bg-surface">
        <Total label={t('net_income')} value={result.totals.net_income.decimal} strong />
        {result.unallocated ? (
          <div className="border-t border-border px-3 py-2 text-xs text-muted">
            <p className="mb-1">{t('unallocated')}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>{t('total_revenue')}: <Money value={result.unallocated.total_revenue.decimal} /></span>
              <span>{t('total_expense')}: <Money value={result.unallocated.total_expense.decimal} /></span>
              <span>{t('net_income')}: <Money value={result.unallocated.net_income.decimal} /></span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
