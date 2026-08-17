'use client';

/**
 * أسلوب «دفتر التحليل»: تبقى الجداول هي مصدر المقارنة على سطح المكتب، بينما
 * تتحول الحركة المتعددة الأعمدة إلى بطاقات لمس موجزة على الجوال.
 */

import Link from 'next/link';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatRiyal, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';

/** صفّ «تسمية ← قيمة» — وحدة عرض البيانات في هذه الشاشة. */
export function KeyValue({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={cn('font-medium text-text', mono && 'num')}>
        {href ? (
          <Link href={href} className="text-primary hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

export function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-y border-border bg-background px-4 py-2 text-xs font-semibold text-muted">
      {children}
    </div>
  );
}

/** حالة فارغة صريحة — لا شاشة بيضاء صامتة (مبدأ «حالات صريحة»). */
export function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{children}</p>;
}

export interface DocRow {
  id: string;
  number: string;
  date: string | null;
  status: string;
  total: string;
  /** المتبقّي — للفواتير فقط. */
  remaining?: string;
}

const STATUS_TONE: Record<string, 'positive' | 'warning' | 'negative' | 'muted' | 'neutral'> = {
  posted: 'positive', paid: 'positive', accepted: 'positive', converted: 'positive',
  draft: 'muted', sent: 'neutral', open: 'warning', partial: 'warning', unpaid: 'warning',
  cancelled: 'negative', rejected: 'negative',
};

/**
 * جدول مستندات الطرف. يعرض المتبقّي فقط حين يكون له معنى (الفواتير)،
 * فلا يظهر عمود فارغ في عروض الأسعار والإشعارات.
 */
export function DocTable({
  rows,
  href,
  labels,
  statusLabel,
  withRemaining,
}: {
  rows: DocRow[];
  href: (id: string) => string;
  labels: { number: string; date: string; status: string; total: string; remaining: string; empty: string };
  statusLabel: (s: string) => string;
  withRemaining?: boolean;
}) {
  if (rows.length === 0) return <EmptyPanel>{labels.empty}</EmptyPanel>;

  return (
    <Table>
      <THead>
        <TR>
          <TH>{labels.number}</TH>
          <TH>{labels.date}</TH>
          <TH>{labels.status}</TH>
          <TH className="text-end">{labels.total}</TH>
          {withRemaining && <TH className="text-end">{labels.remaining}</TH>}
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>
              <Link href={href(r.id)} className="num font-medium text-primary hover:underline">
                {r.number}
              </Link>
            </TD>
            <TD className="num text-muted">{r.date ?? '—'}</TD>
            <TD>
              <Badge tone={STATUS_TONE[r.status] ?? 'muted'}>{statusLabel(r.status)}</Badge>
            </TD>
            <TD className="num text-end">{formatRiyal(r.total)}</TD>
            {withRemaining && (
              <TD className={cn('num text-end', Number(r.remaining ?? 0) > 0 && 'text-negative')}>
                {formatRiyal(r.remaining ?? '0')}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export interface StatementAllocation {
  kind: string;
  id: string;
  number: string | null;
  amount: string;
}

export interface StatementSource {
  kind: string;
  id: string;
  label: string | null;
  allocations: StatementAllocation[];
}

export interface StatementRow {
  date: string;
  number: string;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
  source?: StatementSource | null;
}

/** حركة الحساب — سطور القيد المرحّلة المرتبطة بالطرف، برصيد متحرّك. */
export function LedgerTable({
  opening,
  rows,
  labels,
  sourceHref,
  allocationHref,
  creditBalance = false,
}: {
  opening: string;
  rows: StatementRow[];
  labels: {
    date: string; number: string; source: string; description: string; settlement: string;
    debit: string; credit: string; balance: string; opening: string; empty: string;
  };
  sourceHref?: (source: StatementSource) => string | undefined;
  allocationHref?: (allocation: StatementAllocation) => string | undefined;
  /** الطرف المورد طبيعته دائنة؛ يعرض الرصيد بمقدار موجب لتفادي إيهام المستخدم بخطأ. */
  creditBalance?: boolean;
}) {
  const displayBalance = (value: string) => {
    if (!creditBalance) return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.abs(numeric).toFixed(2) : value;
  };

  return (
    <>
      <div className="space-y-2 md:hidden">
        <article className="rounded border border-border bg-primary-soft p-3.5">
          <p className="text-xs font-medium text-muted">{labels.opening}</p>
          <p className="num mt-1 text-lg font-semibold text-text">{formatRiyal(displayBalance(opening))}</p>
        </article>
        {rows.map((row, index) => {
          const source = row.source?.label;
          const sourceLink = row.source && sourceHref?.(row.source);
          return (
            <article key={`${row.number}-${index}`} className="rounded border border-border bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{row.description ?? source ?? '—'}</p>
                  <p className="num mt-1 text-xs text-muted">{row.date} · {row.number}</p>
                </div>
                <p className={cn('num text-sm font-semibold', !creditBalance && isNegative(row.balance) ? 'text-negative' : 'text-text')}>
                  {formatRiyal(displayBalance(row.balance))}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <div><dt className="text-[11px] font-medium text-muted">{labels.debit}</dt><dd className="num mt-1 text-sm font-medium text-text">{row.debit !== '0.00' ? formatRiyal(row.debit) : '—'}</dd></div>
                <div><dt className="text-[11px] font-medium text-muted">{labels.credit}</dt><dd className="num mt-1 text-sm font-medium text-text">{row.credit !== '0.00' ? formatRiyal(row.credit) : '—'}</dd></div>
                {source && <div className="col-span-2"><dt className="text-[11px] font-medium text-muted">{labels.source}</dt><dd className="mt-1 text-sm font-medium text-text">{sourceLink ? <Link href={sourceLink} className="text-primary hover:underline">{source}</Link> : source}</dd></div>}
              </dl>
              {row.source?.allocations?.length ? <div className="mt-3 border-t border-border pt-3"><p className="text-[11px] font-medium text-muted">{labels.settlement}</p><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">{row.source.allocations.map((allocation, allocationIndex) => { const label = `${allocation.number ?? '—'} · ${formatRiyal(allocation.amount)}`; const href = allocationHref?.(allocation); return href ? <Link key={`${allocation.id}-${allocationIndex}`} href={href} className="num text-xs text-primary hover:underline">{label}</Link> : <span key={`${allocation.id}-${allocationIndex}`} className="num text-xs text-muted">{label}</span>; })}</div></div> : null}
            </article>
          );
        })}
        {rows.length === 0 && <EmptyPanel>{labels.empty}</EmptyPanel>}
      </div>
      <Table className="hidden md:table">
      <THead>
        <TR>
          <TH>{labels.date}</TH>
          <TH>{labels.number}</TH>
          <TH>{labels.source}</TH>
          <TH>{labels.description}</TH>
          <TH>{labels.settlement}</TH>
          <TH className="text-end">{labels.debit}</TH>
          <TH className="text-end">{labels.credit}</TH>
          <TH className="text-end">{labels.balance}</TH>
        </TR>
      </THead>
      <TBody>
        <TR className="text-muted">
          <TD />
          <TD />
          <TD />
          <TD>{labels.opening}</TD>
          <TD />
          <TD />
          <TD />
          <TD className="num text-end">{formatRiyal(displayBalance(opening))}</TD>
        </TR>
        {rows.map((r, i) => (
          <TR key={i}>
            <TD className="num text-muted">{r.date}</TD>
            <TD className="num">{r.number}</TD>
            <TD>
              {r.source?.label && sourceHref?.(r.source) ? (
                <Link href={sourceHref(r.source)!} className="font-medium text-primary hover:underline">
                  {r.source.label}
                </Link>
              ) : r.source?.label ?? '—'}
            </TD>
            <TD>{r.description ?? '—'}</TD>
            <TD>
              {r.source?.allocations?.length ? (
                <div className="flex min-w-[10rem] flex-col gap-1 text-xs">
                  {r.source.allocations.map((allocation, allocationIndex) => {
                    const label = `${allocation.number ?? '—'} · ${formatRiyal(allocation.amount)}`;
                    const href = allocationHref?.(allocation);
                    return href ? (
                      <Link key={`${allocation.id}-${allocationIndex}`} href={href} className="num text-primary hover:underline">
                        {label}
                      </Link>
                    ) : <span key={`${allocation.id}-${allocationIndex}`} className="num text-muted">{label}</span>;
                  })}
                </div>
              ) : '—'}
            </TD>
            <TD className="num text-end">{r.debit !== '0.00' ? formatRiyal(r.debit) : '—'}</TD>
            <TD className="num text-end">{r.credit !== '0.00' ? formatRiyal(r.credit) : '—'}</TD>
            <TD className={cn('num text-end', !creditBalance && isNegative(r.balance) && 'text-negative')}>
              {formatRiyal(displayBalance(r.balance))}
            </TD>
          </TR>
        ))}
        {rows.length === 0 && (
          <TR>
            <TD colSpan={8} className="py-8 text-center text-muted">{labels.empty}</TD>
          </TR>
        )}
      </TBody>
      </Table>
    </>
  );
}
