'use client';

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

export interface StatementRow {
  date: string;
  number: string;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
}

/** حركة الحساب — سطور القيد المرحّلة المرتبطة بالطرف، برصيد متحرّك. */
export function LedgerTable({
  opening,
  rows,
  labels,
}: {
  opening: string;
  rows: StatementRow[];
  labels: {
    date: string; number: string; description: string; debit: string; credit: string;
    balance: string; opening: string; empty: string;
  };
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>{labels.date}</TH>
          <TH>{labels.number}</TH>
          <TH>{labels.description}</TH>
          <TH className="text-end">{labels.debit}</TH>
          <TH className="text-end">{labels.credit}</TH>
          <TH className="text-end">{labels.balance}</TH>
        </TR>
      </THead>
      <TBody>
        <TR className="text-muted">
          <TD />
          <TD />
          <TD>{labels.opening}</TD>
          <TD />
          <TD />
          <TD className="num text-end">{formatRiyal(opening)}</TD>
        </TR>
        {rows.map((r, i) => (
          <TR key={i}>
            <TD className="num text-muted">{r.date}</TD>
            <TD className="num">{r.number}</TD>
            <TD>{r.description ?? '—'}</TD>
            <TD className="num text-end">{r.debit !== '0.00' ? formatRiyal(r.debit) : '—'}</TD>
            <TD className="num text-end">{r.credit !== '0.00' ? formatRiyal(r.credit) : '—'}</TD>
            <TD className={cn('num text-end', isNegative(r.balance) && 'text-negative')}>
              {formatRiyal(r.balance)}
            </TD>
          </TR>
        ))}
        {rows.length === 0 && (
          <TR>
            <TD colSpan={6} className="py-8 text-center text-muted">{labels.empty}</TD>
          </TR>
        )}
      </TBody>
    </Table>
  );
}
