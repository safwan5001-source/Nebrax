'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { cellText, type Lang } from './format';
import type { ReportColumn, ReportTable as Table } from './schemas';

/**
 * جدول تقرير وقود: ترويسة لاصقة، عمود أول لاصق على الجوال، تمرير أفقي، وصف إجمالي. الأرقام `dir="ltr"` بأرقام 0–9 دائماً.
 * عرض تدريجي (200 صف ثم «عرض المزيد») كي لا يثقل الجوال؛ الملف المصدَّر يحوي كل الصفوف.
 */
const PAGE = 200;
const NUMERIC = new Set(['int', 'liters', 'money', 'bp']);

export function ReportTable({ table, lang, timezone, labels }: { table: Table; lang: Lang; timezone: string; labels: { total: string; empty: string; more: string; rows: string } }) {
  const [visible, setVisible] = useState(PAGE);
  const shown = table.rows.slice(0, visible);
  const align = (c: ReportColumn) => (NUMERIC.has(c.type) ? 'text-end' : 'text-start');

  return (
    <section aria-label={table.title[lang]} data-report-table={table.key} className="space-y-2">
      <h3 className="text-sm font-semibold text-text">{table.title[lang]} <span className="num text-xs font-normal text-muted">({table.rows.length})</span></h3>
      {table.rows.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{labels.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead className="bg-primary-soft text-xs text-muted">
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c.key} scope="col" className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', align(c), i === 0 && 'sticky start-0 z-10 bg-primary-soft')}>{c.label[lang]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <tr key={index} className="border-t border-border/70 odd:bg-transparent even:bg-[color:var(--fo-zebra,transparent)]">
                  {table.columns.map((c, i) => {
                    const value = cellText(c, row[c.key], lang, timezone);
                    const numeric = NUMERIC.has(c.type) || c.type === 'datetime' || c.type === 'date';
                    return (
                      <td key={c.key} dir={numeric ? 'ltr' : undefined} className={cn('whitespace-nowrap px-3 py-2.5 text-text', align(c), numeric && 'num', i === 0 && 'sticky start-0 z-[1] bg-surface font-medium', value === '—' && 'text-muted')}>{value}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {table.totals ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-primary-soft font-semibold text-text">
                  {table.columns.map((c, i) => {
                    const has = table.totals !== null && c.key in table.totals;
                    return (
                      <td key={c.key} dir="ltr" className={cn('whitespace-nowrap px-3 py-2.5', align(c), 'num', i === 0 && 'sticky start-0 z-[1] bg-primary-soft')}>
                        {i === 0 ? labels.total : has ? cellText(c, table.totals?.[c.key], lang, timezone) : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {table.rows.length > visible ? (
        <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="min-h-11 w-full rounded-[11px] border border-[color:var(--fo-control,var(--border))] bg-surface text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {labels.more} ({table.rows.length - visible} {labels.rows})
        </button>
      ) : null}
    </section>
  );
}

/** أعمدة أفقية بسيطة (SVG لا مكتبة): أول عمود وصفي × أول عمود لترات، حتى 12 صفاً. للقراءة السريعة فقط؛ القيم الدقيقة في الجدول. */
export function MiniBars({ table, lang, label }: { table: Table; lang: Lang; label: string }) {
  const labelCol = table.columns.find((c) => c.type === 'text' || c.type === 'date');
  const valueCol = table.columns.find((c) => c.type === 'liters');
  if (!labelCol || !valueCol) return null;
  const rows = table.rows.slice(0, 12).map((r) => ({ name: String(r[labelCol.key] ?? ''), value: Number(r[valueCol.key] ?? 0) })).filter((r) => Number.isFinite(r.value));
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length < 2 || rows.every((r) => r.value === 0)) return null;

  return (
    <figure aria-label={label} data-report-chart="" className="space-y-1.5 rounded-[12px] border border-border bg-surface p-3">
      <figcaption className="text-xs font-semibold text-muted">{label} — {valueCol.label[lang]}</figcaption>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-2 text-xs">
          <span className="truncate text-text">{r.name}</span>
          <span className="h-3 rounded-sm bg-primary-soft" aria-hidden="true"><span className="block h-3 rounded-sm bg-primary" style={{ width: `${Math.max(2, Math.round((Math.max(0, r.value) / max) * 100))}%` }} /></span>
        </div>
      ))}
    </figure>
  );
}
