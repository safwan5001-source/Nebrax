'use client';

import * as React from 'react';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface LedgerLine {
  id: string;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  debit: string;
  credit: string;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
}

export interface LedgerLinesLabels {
  account: string;
  description: string;
  costCenter?: string;
  debit: string;
  credit: string;
  totals: string;
  unknownAccount: string;
}

function accountLabel(line: LedgerLine, unknown: string) {
  return line.account_name ?? unknown;
}

function costCenterLabel(line: LedgerLine) {
  if (!line.cost_center_name) return null;
  return [line.cost_center_code, line.cost_center_name].filter(Boolean).join(' — ');
}

/**
 * بنود قيدٍ محاسبي: جدولٌ على الديسكتوب، وسجلّاتٌ مركّبة على الجوال.
 *
 * ضغط جدول المدين/الدائن في شاشة 390px يجعل كل عمود أضيق من رقمه، فالجوال يعرض
 * لكل بند سطرَ حساب ثم مبلغاً واحداً موسوماً بجانبه (مدين أو دائن) — لأن البند
 * الواحد لا يحمل الاثنين معاً في القيد المزدوج، فعرض خانتين إحداهما فارغة دائماً
 * إهدارٌ لعرضٍ نادر.
 *
 * الجانب دلاليٌّ بالنصّ لا باللون وحده: الوسم مكتوب، واللون تأكيدٌ فوقه.
 */
export function LedgerLinesTable({
  lines,
  labels,
  showCostCenter = false,
  className,
}: {
  lines: LedgerLine[];
  labels: LedgerLinesLabels;
  showCostCenter?: boolean;
  className?: string;
}) {
  const totals = React.useMemo(
    () =>
      lines.reduce(
        (sum, line) => ({
          debit: sum.debit + Number(line.debit || 0),
          credit: sum.credit + Number(line.credit || 0),
        }),
        { debit: 0, credit: 0 }
      ),
    [lines]
  );

  const withCostCenter = showCostCenter && Boolean(labels.costCenter);

  return (
    <div className={className}>
      {/* ديسكتوب: الجدول هو البطل — أعمدة قابلة للمقارنة رأسياً وتذييل إجماليات. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead className="border-y border-border bg-muted/40 text-muted">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{labels.account}</th>
              <th className="px-4 py-3 text-start font-medium">{labels.description}</th>
              {withCostCenter ? <th className="px-4 py-3 text-start font-medium">{labels.costCenter}</th> : null}
              <th className="px-4 py-3 text-end font-medium">{labels.debit}</th>
              <th className="px-4 py-3 text-end font-medium">{labels.credit}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <span className="num text-muted">{line.account_code}</span> {accountLabel(line, labels.unknownAccount)}
                </td>
                <td className="px-4 py-3 text-muted">{line.description || '—'}</td>
                {withCostCenter ? <td className="px-4 py-3 text-muted">{costCenterLabel(line) ?? '—'}</td> : null}
                <td className="num px-4 py-3 text-end text-negative">
                  {Number(line.debit) ? formatRiyal(line.debit) : '—'}
                </td>
                <td className="num px-4 py-3 text-end text-positive">
                  {Number(line.credit) ? formatRiyal(line.credit) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/40 font-semibold text-text">
            <tr>
              <td colSpan={withCostCenter ? 3 : 2} className="px-4 py-3">
                {labels.totals}
              </td>
              <td className="num px-4 py-3 text-end">{formatRiyal(totals.debit)}</td>
              <td className="num px-4 py-3 text-end">{formatRiyal(totals.credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* جوال: سجلٌّ لكل بند — الحساب أولاً، ثم المبلغ موسوماً بجانبه. */}
      <ul className="divide-y divide-border md:hidden">
        {lines.map((line) => {
          const isDebit = Number(line.debit) > 0;
          const amount = isDebit ? line.debit : line.credit;
          const center = costCenterLabel(line);

          return (
            <li key={line.id} className="flex items-start justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">
                  {line.account_code ? <span className="num text-muted">{line.account_code}</span> : null}{' '}
                  {accountLabel(line, labels.unknownAccount)}
                </div>
                {line.description ? (
                  <div className="mt-0.5 truncate text-sm text-muted">{line.description}</div>
                ) : null}
                {withCostCenter && center ? (
                  <div className="mt-0.5 truncate text-xs text-muted/80">{center}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-end">
                <div className="text-[11px] leading-tight text-muted">{isDebit ? labels.debit : labels.credit}</div>
                <div
                  className={cn(
                    'num text-base font-semibold leading-tight',
                    isDebit ? 'text-negative' : 'text-positive'
                  )}
                >
                  {formatRiyal(amount)}
                </div>
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-3 bg-muted/40 px-3.5 py-3 text-sm font-semibold text-text">
          <span>{labels.totals}</span>
          <span className="flex items-baseline gap-3">
            <span className="text-end">
              <span className="block text-[11px] font-medium leading-tight text-muted">{labels.debit}</span>
              <span className="num">{formatRiyal(totals.debit)}</span>
            </span>
            <span className="text-end">
              <span className="block text-[11px] font-medium leading-tight text-muted">{labels.credit}</span>
              <span className="num">{formatRiyal(totals.credit)}</span>
            </span>
          </span>
        </li>
      </ul>
    </div>
  );
}
