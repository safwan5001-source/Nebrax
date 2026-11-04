'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import type { MobileRecord } from '@/components/nebrax';
import { formatMinor, partnerDisplayName, STATUS_TONE, type ReconciliationRow } from './contract';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const iso = (value: string | null): string => (value ? value.slice(0, 10) : '—');

export function StatusBadge({ status, t }: { status: ReconciliationRow['status']; t: Translate }) {
  return <Badge tone={STATUS_TONE[status] ?? 'muted'}>{t(`status.${status}`)}</Badge>;
}

export function periodLabel(row: Pick<ReconciliationRow, 'period_from' | 'period_to'>): string {
  return `${row.period_from} → ${row.period_to}`;
}

/** الفرع: «المؤسسة كلها» حين لا فرع في السياسة المجمَّدة. */
export function scopeLabel(row: Pick<ReconciliationRow, 'branch_id' | 'branch'>, t: Translate): string {
  if (row.branch_id === null) return t('scope.organization');
  return row.branch?.name ?? t('scope.branch');
}

export function buildColumns(t: Translate): ColumnDef<ReconciliationRow, unknown>[] {
  return [
    {
      id: 'partner_name',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => partnerDisplayName(row),
      header: t('col.partner'),
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text">{partnerDisplayName(row.original)}</p>
          <p className="text-xs text-muted">{t(`role.${row.original.role}`)}</p>
        </div>
      ),
    },
    {
      id: 'period_from',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => row.period_from,
      header: t('col.period'),
      cell: ({ row }) => <span className="num whitespace-nowrap text-text" dir="ltr">{periodLabel(row.original)}</span>,
    },
    {
      id: 'scope',
      header: t('col.scope'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted">{scopeLabel(row.original, t)}</span>,
    },
    {
      id: 'original_filename',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => row.original_filename ?? '',
      header: t('col.file'),
      cell: ({ row }) => <span className="block max-w-[14rem] truncate text-muted" dir="auto" title={row.original.original_filename ?? undefined}>{row.original.original_filename ?? '—'}</span>,
    },
    {
      id: 'line_count',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => row.line_count,
      header: t('col.lines'),
      cell: ({ row }) => <div className="num text-end text-text">{row.original.line_count}</div>,
    },
    {
      id: 'totals',
      header: t('col.totals'),
      enableSorting: false,
      cell: ({ row }) => (
        <div className="num space-y-0.5 text-end text-xs" dir="ltr">
          <p className="text-text">{t('col.debit_short')} {formatMinor(row.original.total_debit_minor)}</p>
          <p className="text-muted">{t('col.credit_short')} {formatMinor(row.original.total_credit_minor)}</p>
        </div>
      ),
    },
    {
      id: 'status',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => row.status,
      header: t('col.status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} t={t} />,
    },
    {
      id: 'created_at',
      // TanStack لا يعدّ العمود قابلاً للفرز بلا accessor (والفرز خادمي: القيمة هنا للتعريف لا للترتيب المحلي).
      accessorFn: (row) => row.created_at ?? '',
      header: t('col.created'),
      cell: ({ row }) => <span className="num text-muted" dir="ltr">{iso(row.original.created_at)}</span>,
    },
  ];
}

/** بطاقة الجوال بهرم الأهمية: الطرف ← الدور/الفترة ← الإجمالي ← الحالة ← الملف والتاريخ. */
export function mobileRecordFor(row: ReconciliationRow, t: Translate): MobileRecord {
  return {
    title: <span className="font-medium text-text">{partnerDisplayName(row)}</span>,
    subtitle: `${t(`role.${row.role}`)} · ${scopeLabel(row, t)}`,
    // الفترة سطر مستقل معزول الاتجاه: بدمجها مع الدور كان الاقتطاع يقصّ التاريخ ويعكس ترتيبه في RTL.
    caption: <span className="num whitespace-nowrap" dir="ltr">{periodLabel(row)}</span>,
    amountLabel: t('col.debit_short'),
    amount: <span dir="ltr">{formatMinor(row.total_debit_minor)}</span>,
    secondary: { label: t('col.credit_short'), value: <span dir="ltr">{formatMinor(row.total_credit_minor)}</span> },
    status: <StatusBadge status={row.status} t={t} />,
    meta: (
      <span>
        <span className="num">{row.line_count}</span> {t('col.lines_unit')} · <span className="num" dir="ltr">{iso(row.created_at)}</span>
      </span>
    ),
  };
}
