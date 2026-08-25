import Link from 'next/link';
import type { ReactNode } from 'react';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatRiyal } from '@/lib/money';

export type FinancialStatementRowKind = 'detail' | 'subtotal' | 'grand-total' | 'equation' | 'empty';
export type FinancialSemanticTone = 'auto' | 'positive' | 'negative';

export interface FinancialStatementRow {
  id: string;
  kind: FinancialStatementRowKind;
  label: string;
  amount?: string;
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
  amountLabel: string;
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

function amountClassName(row: FinancialStatementRow) {
  if (row.tone === 'positive') return 'text-positive';
  if (row.tone === 'negative') return 'text-negative';
  if (row.tone === 'auto' && row.amount) {
    const numericValue = Number(row.amount);
    if (numericValue > 0) return 'text-positive';
    if (numericValue < 0) return 'text-negative';
  }
  return 'text-text';
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

function StatementDesktopRow({ row }: { row: FinancialStatementRow }) {
  const isSubtotal = row.kind === 'subtotal';
  const isEmpty = row.kind === 'empty';

  return (
    <TR
      className={[
        isSubtotal ? 'border-t border-border bg-background font-semibold hover:bg-background' : '',
        isEmpty ? 'hover:bg-transparent' : '',
      ].filter(Boolean).join(' ')}
    >
      <TH scope="row" className={`px-3 py-2 text-start font-medium ${isSubtotal ? 'text-text' : isEmpty ? 'text-muted' : 'text-text'}`}>
        {rowLabel(row)}
      </TH>
      <TD className={`num px-3 py-2 text-end tabular-nums ${isSubtotal ? 'font-semibold' : ''} ${amountClassName(row)}`}>
        {row.amount === undefined ? '—' : formatRiyal(row.amount)}
      </TD>
    </TR>
  );
}

function StatementMobileRow({ row }: { row: FinancialStatementRow }) {
  const isSubtotal = row.kind === 'subtotal';
  const isEmpty = row.kind === 'empty';

  return (
    <li
      className={[
        'flex min-h-10 items-center justify-between gap-4 px-3 py-2.5 text-sm',
        isSubtotal ? 'border-t border-border bg-background font-semibold text-text' : '',
        isEmpty ? 'justify-center text-muted' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={`min-w-0 ${isEmpty ? 'text-center' : ''}`}>{rowLabel(row)}</div>
      {!isEmpty && (
        <span className={`num shrink-0 text-end tabular-nums ${isSubtotal ? 'font-semibold' : 'font-medium'} ${amountClassName(row)}`}>
          {row.amount === undefined ? '—' : formatRiyal(row.amount)}
        </span>
      )}
    </li>
  );
}

function GrandTotal({ row, mobile = false }: { row: FinancialStatementRow; mobile?: boolean }) {
  const content = (
    <>
      <span className="min-w-0 font-semibold text-text">{row.label}</span>
      <span className={`num shrink-0 text-end font-semibold tabular-nums ${amountClassName(row)}`}>
        {row.amount === undefined ? '—' : formatRiyal(row.amount)}
      </span>
    </>
  );

  if (mobile) {
    return <div className="mt-3 flex min-h-12 items-center justify-between gap-4 rounded border border-primary/20 bg-primary-soft px-3 py-3 text-sm">{content}</div>;
  }

  return (
    <TR className="border-t-2 border-primary/20 bg-primary-soft font-semibold text-text hover:bg-primary-soft">
      <TH scope="row" className="px-3 py-3 text-start font-semibold">{row.label}</TH>
      <TD className={`num px-3 py-3 text-end font-semibold tabular-nums ${amountClassName(row)}`}>
        {row.amount === undefined ? '—' : formatRiyal(row.amount)}
      </TD>
    </TR>
  );
}

function Equation({ row, mobile = false }: { row: FinancialStatementRow; mobile?: boolean }) {
  const content = (
    <>
      <span className="min-w-0 text-muted">{row.label}</span>
      <span className={`num shrink-0 text-end tabular-nums ${amountClassName(row)}`}>
        {row.amount === undefined ? '—' : formatRiyal(row.amount)}
      </span>
    </>
  );

  if (mobile) {
    return <div className="mt-2 flex min-h-10 items-center justify-between gap-4 border-t border-border px-3 py-2.5 text-xs">{content}</div>;
  }

  return (
    <TR className="border-t border-border text-sm hover:bg-transparent">
      <TH scope="row" className="px-3 py-2.5 text-start font-medium text-muted">{row.label}</TH>
      <TD className={`num px-3 py-2.5 text-end tabular-nums ${amountClassName(row)}`}>
        {row.amount === undefined ? '—' : formatRiyal(row.amount)}
      </TD>
    </TR>
  );
}

/**
 * عرض شاشة فقط للقوائم الرسمية: يثبت الترتيب المحاسبي ولا يضيف فرزًا أو ترقيمًا
 * أو تخصيص أعمدة. تظلّ بنية مستند التصدير المنفصلة مصدر PDF/CSV/Print/Share كما هي.
 */
export function StructuredFinancialStatement({
  descriptionLabel,
  amountLabel,
  sections,
  grandTotal,
  equation,
  className = '',
}: StructuredFinancialStatementProps) {
  return (
    <div className={className} data-testid="structured-financial-statement">
      <div className="space-y-4 md:hidden" data-testid="structured-financial-statement-mobile">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`statement-section-${section.id}`}>
            <h3 id={`statement-section-${section.id}`} className="border-b border-border px-3 py-2 text-xs font-semibold text-muted">
              {section.label}
            </h3>
            <ul className="divide-y divide-border rounded border border-border bg-surface" aria-label={section.label}>
              {section.rows.map((row) => <StatementMobileRow key={row.id} row={row} />)}
            </ul>
          </section>
        ))}
        {grandTotal && <GrandTotal row={grandTotal} mobile />}
        {equation && <Equation row={equation} mobile />}
      </div>

      <div className="hidden overflow-hidden rounded border border-border bg-surface md:block" data-testid="structured-financial-statement-desktop">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH scope="col">{descriptionLabel}</TH>
              <TH scope="col" className="text-end">{amountLabel}</TH>
            </TR>
          </THead>
          {sections.map((section) => (
            <TBody key={section.id} aria-label={section.label}>
              <TR className="bg-background hover:bg-background">
                <TH scope="rowgroup" colSpan={2} className="px-3 py-2 text-start text-xs font-semibold text-muted">{section.label}</TH>
              </TR>
              {section.rows.map((row) => <StatementDesktopRow key={row.id} row={row} />)}
            </TBody>
          ))}
          {(grandTotal || equation) && (
            <tfoot>
              {grandTotal && <GrandTotal row={grandTotal} />}
              {equation && <Equation row={equation} />}
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  );
}
