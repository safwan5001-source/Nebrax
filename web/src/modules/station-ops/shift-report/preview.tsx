'use client';

import { cn } from '@/lib/utils';
import type { Cell, ReportSection, ShiftReportModel } from './model';

/**
 * AWJ-DOC-V2-PR7 — معاينة التقرير (DOM) من **النموذج نفسه** الذي يرسمه الـPDF: لا حقل ولا قيمة هنا غير ما في `ShiftReportModel`.
 * جوال أولاً (لا تجاوز أفقي للصفحة؛ الجدول العريض يتمرّر داخل غلافه وحده)، RTL/LTR بالخصائص المنطقية، والأرقام كما وصلت (0–9).
 */
/** نص لاتيني/أرقام فقط (تاريخ، لترات، رقم وردية) يُعزل LTR كي لا يقلب سياق RTL ترتيب «التاريخ الوقت»؛ ما فيه عربية يُترك لسياقه. */
const LATIN_ONLY = /^[\x20-\x7E]+$/;

function CellText({ cell }: { cell: Cell }) {
  const ltr = LATIN_ONLY.test(cell.text);
  return <span dir={ltr ? 'ltr' : undefined} className={cn(cell.na ? 'text-muted' : 'text-text', cell.strong && !cell.na && 'font-semibold', ltr && 'inline-block')}>{cell.text}</span>;
}

function Section({ section }: { section: ReportSection }) {
  if (section.kind === 'note') {
    return <p data-report-note={section.key} className={cn('rounded-md px-3 py-2 text-xs leading-5', section.tone === 'warning' ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-[color:var(--fo-soft,transparent)] text-muted')}>{section.text}</p>;
  }
  if (section.kind === 'kv') {
    return (
      <section data-report-section={section.key} className="space-y-2">
        {section.title ? <h3 className="rounded-md bg-primary-soft px-3 py-1.5 text-sm font-bold text-primary">{section.title}</h3> : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {section.rows.map((row) => (
            <div key={row.label} className="min-w-0 border-b border-border pb-1.5">
              <dt className="text-[11px] leading-4 text-muted">{row.label}</dt>
              <dd className="num break-words text-sm leading-5"><CellText cell={row.value} /></dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (section.kind === 'table') {
    return (
      <section data-report-section={section.key} className="space-y-2">
        <h3 className="rounded-md bg-primary-soft px-3 py-1.5 text-sm font-bold text-primary">{section.title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {section.columns.map((column) => <th key={column.key} scope="col" className={cn('whitespace-nowrap px-1.5 py-1 text-[11px] font-semibold text-muted', column.align === 'end' ? 'text-end' : 'text-start')}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {section.rows.length === 0 ? <tr><td colSpan={section.columns.length} className="px-1.5 py-2 text-muted">—</td></tr> : null}
              {section.rows.map((cells, index) => (
                <tr key={index} className="border-t border-border">
                  {cells.map((cell, i) => <td key={i} className={cn('num px-1.5 py-1.5 align-top', section.columns[i].align === 'end' ? 'whitespace-nowrap text-end tabular-nums' : 'text-start')}><CellText cell={cell} /></td>)}
                </tr>
              ))}
            </tbody>
            {section.totals ? (
              <tfoot>
                <tr className="border-t-2 border-primary">
                  {section.totals.map((cell, i) => <td key={i} className={cn('num px-1.5 py-1.5 font-bold', section.columns[i].align === 'end' ? 'whitespace-nowrap text-end tabular-nums' : 'text-start')}><CellText cell={{ ...cell, strong: true }} /></td>)}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>
    );
  }
  return (
    <section data-report-section={section.key} className="space-y-3">
      <h3 className="rounded-md bg-primary-soft px-3 py-1.5 text-sm font-bold text-primary">{section.title}</h3>
      <div className="grid grid-cols-3 gap-3">
        {section.cells.map((cell) => (
          <div key={cell.role} className="min-w-0 text-center">
            <p className="text-xs font-bold text-primary">{cell.role}</p>
            <p className="min-h-5 text-xs">{cell.name ? <CellText cell={cell.name} /> : null}</p>
            <p className="min-h-4 text-[11px] text-muted">{cell.when ?? ''}</p>
            <div className="mt-5 border-t border-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ShiftReportPreview({ model }: { model: ShiftReportModel }) {
  return (
    <article data-shift-report-preview="" data-paper={model.paper} aria-label={model.title} className="space-y-4 text-text">
      <header className="rounded-lg bg-[var(--fo-navy)] p-3 text-[color:var(--fo-on-navy)]">
        <p className="break-words text-base font-bold">{model.company.name}</p>
        <p className="text-[11px] opacity-80">
          {[model.company.vat ? `${model.labels.vat}: ${model.company.vat}` : null, model.company.cr ? `${model.labels.cr}: ${model.company.cr}` : null].filter(Boolean).join('   ')}
        </p>
        <p className="mt-2 text-sm font-semibold">{model.title}</p>
        <p className="text-[11px] opacity-80">{model.variantLabel} — {model.status.label}</p>
      </header>
      {model.sections.map((section) => <Section key={`${section.kind}-${section.key}`} section={section} />)}
      <footer className="border-t border-border pt-2 text-[11px] text-muted">{model.labels.generatedAt}: <span className="num">{model.generatedAt}</span></footer>
    </article>
  );
}
