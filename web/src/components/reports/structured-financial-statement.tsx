import Link from 'next/link';
import type { ReactNode } from 'react';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatRiyal } from '@/lib/money';

export type FinancialStatementRowKind = 'detail' | 'subtotal' | 'grand-total' | 'equation' | 'empty';
export type FinancialSemanticTone = 'auto' | 'positive' | 'negative';
export type FinancialValueFormat = 'currency' | 'percentage';
export type FinancialColumnPriority = 'primary' | 'secondary' | 'tertiary';

export interface FinancialStatementColumn {
  id: string;
  label: string;
  format?: FinancialValueFormat;
  priority?: FinancialColumnPriority;
}

export interface FinancialStatementValue {
  id: string;
  amount?: string;
  tone?: FinancialSemanticTone;
}

export interface FinancialStatementRow {
  id: string;
  kind: FinancialStatementRowKind;
  label: string;
  amount?: string;
  values?: FinancialStatementValue[];
  code?: string;
  level?: 0 | 1 | 2 | 3;
  tone?: FinancialSemanticTone;
  href?: string;
}

export interface FinancialStatementSection {
  id: string;
  label: string;
  rows: FinancialStatementRow[];
}

interface StructuredFinancialStatementProps {
  descriptionLabel: string;
  amountLabel?: string;
  columns?: FinancialStatementColumn[];
  sections: FinancialStatementSection[];
  grandTotal?: FinancialStatementRow;
  equation?: FinancialStatementRow;
  className?: string;
}

const INDENT_CLASS: Record<NonNullable<FinancialStatementRow['level']>, string> = {
  0: 'ps-0',
  1: 'ps-4',
  2: 'ps-8',
  3: 'ps-12',
};

function amountClassName(value?: FinancialStatementValue) {
  if (value?.tone === 'positive') return 'text-positive';
  if (value?.tone === 'negative') return 'text-negative';
  if (value?.tone === 'auto' && value.amount) {
    const numericValue = Number(value.amount);
    if (numericValue > 0) return 'text-positive';
    if (numericValue < 0) return 'text-negative';
  }
  return 'text-text';
}

function columnClassName(column: FinancialStatementColumn) {
  if (column.priority === 'primary') return 'font-semibold text-text';
  if (column.priority === 'tertiary') return 'text-muted';
  return 'text-text';
}

function formatValue(value: FinancialStatementValue | undefined, column: FinancialStatementColumn) {
  if (value?.amount === undefined) return '—';
  return column.format === 'percentage' ? value.amount : formatRiyal(value.amount);
}

function rowValues(row: FinancialStatementRow, columns: FinancialStatementColumn[]) {
  if (row.values) {
    return columns.map((column) => row.values?.find((value) => value.id === column.id));
  }
  return columns.map((column) => column.id === 'amount' ? { id: 'amount', amount: row.amount, tone: row.tone } : undefined);
}

function rowLabel(row: FinancialStatementRow): ReactNode {
  const content = (
    <span className={`min-w-0 ${INDENT_CLASS[row.level ?? 0]}`}>
      {row.code && <span className="num me-2 text-xs text-muted">{row.code}</span>}
      <span>{row.label}</span>
    </span>
  );

  if (row.href && row.kind === 'detail') {
    return (
      <Link
        href={row.href}
        prefetch={false}
        className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {content}
      </Link>
    );
  }

  return content;
}

function ValueCell({ value, column, strong = false }: { value?: FinancialStatementValue; column: FinancialStatementColumn; strong?: boolean }) {
  const formatted = formatValue(value, column);
  return (
    <TD className={`num px-3 py-2 text-end tabular-nums ${strong || column.priority === 'primary' ? 'font-semibold' : ''} ${columnClassName(column)} ${amountClassName(value)}`}>
      <span aria-label={`${column.label}: ${formatted}`}>{formatted}</span>
    </TD>
  );
}

function StatementDesktopRow({ row, columns }: { row: FinancialStatementRow; columns: FinancialStatementColumn[] }) {
  const isSubtotal = row.kind === 'subtotal';
  const isEmpty = row.kind === 'empty';
  const values = rowValues(row, columns);

  if (isEmpty) {
    return (
      <TR className="hover:bg-transparent">
        <TH scope="row" colSpan={columns.length + 1} className="px-3 py-4 text-center font-medium text-muted">{rowLabel(row)}</TH>
      </TR>
    );
  }

  return (
    <TR className={isSubtotal ? 'border-t border-border bg-background font-semibold hover:bg-background' : ''}>
      <TH scope="row" className="px-3 py-2 text-start font-medium text-text">{rowLabel(row)}</TH>
      {values.map((value, index) => <ValueCell key={columns[index].id} value={value} column={columns[index]} strong={isSubtotal} />)}
    </TR>
  );
}

function MobileValues({ columns, values, strong = false }: { columns: FinancialStatementColumn[]; values: Array<FinancialStatementValue | undefined>; strong?: boolean }) {
  const gridColumns = columns.length > 3 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <dl className={`mt-2 grid ${gridColumns} gap-x-3 gap-y-2 border-t border-border pt-2 text-xs`}>
      {columns.map((column, index) => {
        const value = values[index];
        const formatted = formatValue(value, column);
        return (
          <div key={column.id} className="min-w-0">
            <dt className="truncate text-muted">{column.label}</dt>
            <dd aria-label={`${column.label}: ${formatted}`} className={`num mt-1 text-end tabular-nums ${strong || column.priority === 'primary' ? 'font-semibold' : 'font-medium'} ${columnClassName(column)} ${amountClassName(value)}`}>
              {formatted}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function StatementMobileRow({ row, columns }: { row: FinancialStatementRow; columns: FinancialStatementColumn[] }) {
  const isSubtotal = row.kind === 'subtotal';
  const isEmpty = row.kind === 'empty';
  const isMultiValue = columns.length > 1;
  const values = rowValues(row, columns);

  if (isEmpty) return <li className="flex min-h-10 items-center justify-center px-3 py-2.5 text-center text-sm text-muted">{rowLabel(row)}</li>;

  if (isMultiValue) {
    return (
      <li className={`min-h-10 px-3 py-2.5 text-sm ${isSubtotal ? 'border-t border-border bg-background font-semibold text-text' : ''}`}>
        <div className="min-w-0">{rowLabel(row)}</div>
        <MobileValues columns={columns} values={values} strong={isSubtotal} />
      </li>
    );
  }

  const value = values[0];
  return (
    <li className={`flex min-h-10 items-center justify-between gap-4 px-3 py-2.5 text-sm ${isSubtotal ? 'border-t border-border bg-background font-semibold text-text' : ''}`}>
      <div className="min-w-0">{rowLabel(row)}</div>
      <span className={`num shrink-0 text-end tabular-nums ${isSubtotal ? 'font-semibold' : 'font-medium'} ${amountClassName(value)}`}>{formatValue(value, columns[0])}</span>
    </li>
  );
}

function GrandTotal({ row, columns, mobile = false }: { row: FinancialStatementRow; columns: FinancialStatementColumn[]; mobile?: boolean }) {
  const values = rowValues(row, columns);
  const isMultiValue = columns.length > 1;

  if (mobile) {
    if (isMultiValue) {
      return <div className="mt-3 rounded border border-primary/20 bg-primary-soft px-3 py-3 text-sm"><span className="font-semibold text-text">{row.label}</span><MobileValues columns={columns} values={values} strong /></div>;
    }
    const value = values[0];
    return <div className="mt-3 flex min-h-12 items-center justify-between gap-4 rounded border border-primary/20 bg-primary-soft px-3 py-3 text-sm"><span className="min-w-0 font-semibold text-text">{row.label}</span><span className={`num shrink-0 text-end font-semibold tabular-nums ${amountClassName(value)}`}>{formatValue(value, columns[0])}</span></div>;
  }

  return (
    <TR className="border-t-2 border-primary/20 bg-primary-soft font-semibold text-text hover:bg-primary-soft">
      <TH scope="row" className="px-3 py-3 text-start font-semibold">{row.label}</TH>
      {values.map((value, index) => <ValueCell key={columns[index].id} value={value} column={columns[index]} strong />)}
    </TR>
  );
}

function Equation({ row, columns, mobile = false }: { row: FinancialStatementRow; columns: FinancialStatementColumn[]; mobile?: boolean }) {
  const values = rowValues(row, columns);
  const isMultiValue = columns.length > 1;

  if (mobile) {
    if (isMultiValue) return <div className="mt-2 border-t border-border px-3 py-2.5 text-xs"><span className="text-muted">{row.label}</span><MobileValues columns={columns} values={values} /></div>;
    const value = values[0];
    return <div className="mt-2 flex min-h-10 items-center justify-between gap-4 border-t border-border px-3 py-2.5 text-xs"><span className="min-w-0 text-muted">{row.label}</span><span className={`num shrink-0 text-end tabular-nums ${amountClassName(value)}`}>{formatValue(value, columns[0])}</span></div>;
  }

  return <TR className="border-t border-border text-sm hover:bg-transparent"><TH scope="row" className="px-3 py-2.5 text-start font-medium text-muted">{row.label}</TH>{values.map((value, index) => <ValueCell key={columns[index].id} value={value} column={columns[index]} />)}</TR>;
}

/**
 * عرض شاشة فقط للقوائم الرسمية: يثبت الترتيب المحاسبي ولا يضيف فرزاً أو ترقيمًا
 * أو تخصيص أعمدة. تدعم `columns` القيم المالية المحددة مسبقاً، ومنها أعمدة المقارنة؛
 * لا يشكل ذلك Report Builder عاماً ولا يغيّر مستندات التصدير الرسمية.
 */
export function StructuredFinancialStatement({ descriptionLabel, amountLabel, columns, sections, grandTotal, equation, className = '' }: StructuredFinancialStatementProps) {
  const valueColumns = columns?.length ? columns : [{ id: 'amount', label: amountLabel ?? '', priority: 'primary' as const }];

  return (
    <div className={className} data-testid="structured-financial-statement">
      <div className="space-y-4 md:hidden" data-testid="structured-financial-statement-mobile">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`statement-section-${section.id}`}>
            <h3 id={`statement-section-${section.id}`} className="border-b border-border px-3 py-2 text-xs font-semibold text-muted">{section.label}</h3>
            <ul className="divide-y divide-border rounded border border-border bg-surface" aria-label={section.label}>{section.rows.map((row) => <StatementMobileRow key={row.id} row={row} columns={valueColumns} />)}</ul>
          </section>
        ))}
        {grandTotal && <GrandTotal row={grandTotal} columns={valueColumns} mobile />}
        {equation && <Equation row={equation} columns={valueColumns} mobile />}
      </div>

      <div className="hidden overflow-hidden rounded border border-border bg-surface md:block" data-testid="structured-financial-statement-desktop">
        <Table>
          <THead><TR className="hover:bg-transparent"><TH scope="col">{descriptionLabel}</TH>{valueColumns.map((column) => <TH key={column.id} scope="col" className={`text-end ${columnClassName(column)}`}>{column.label}</TH>)}</TR></THead>
          {sections.map((section) => <TBody key={section.id} aria-label={section.label}><TR className="bg-background hover:bg-background"><TH scope="rowgroup" colSpan={valueColumns.length + 1} className="px-3 py-2 text-start text-xs font-semibold text-muted">{section.label}</TH></TR>{section.rows.map((row) => <StatementDesktopRow key={row.id} row={row} columns={valueColumns} />)}</TBody>)}
          {(grandTotal || equation) && <tfoot>{grandTotal && <GrandTotal row={grandTotal} columns={valueColumns} />}{equation && <Equation row={equation} columns={valueColumns} />}</tfoot>}
        </Table>
      </div>
    </div>
  );
}
