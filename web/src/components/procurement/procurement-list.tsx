'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';
import { PROCUREMENT_ROUTE, statusTone, type ProcurementStatus, type ProcurementType } from '@/lib/procurement';

export interface ProcurementDocument {
  id: string;
  type: ProcurementType;
  number: string;
  partner_id: string | null;
  partner_name?: string | null;
  status: ProcurementStatus;
  doc_date: string;
  due_date: string | null;
  requested_by: string | null;
  total: string;
}

/**
 * قائمة مستندات دورة الشراء — مكوّن واحد لأنواعها الأربعة.
 * الشكل واحد والاختلاف في النوع والتسمية فقط، فتفريقها إلى أربع شاشات
 * متطابقة كان سيضاعف موضع كل إصلاح لاحق أربع مرات.
 */
export function ProcurementList({ type }: { type: ProcurementType }) {
  const t = useTranslations('procurement');
  const [data, setData] = useState<ProcurementDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: ProcurementDocument[] }>(`/procurement?type=${type}${branchViewQuery(view, true)}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [type, view]);

  useEffect(() => load(), [load]);

  const route = PROCUREMENT_ROUTE[type];

  const columns = useMemo<ColumnDef<ProcurementDocument, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`${route}/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'party',
        // الطلب وطلب العروض بلا مورّد — يُعرض بدلَه مَن طلب.
        header: type === 'request' ? t('requested_by') : t('supplier'),
        accessorFn: (r) => (type === 'request' ? r.requested_by : r.partner_name) ?? '—',
        cell: ({ row }) => (type === 'request' ? row.original.requested_by : row.original.partner_name) ?? '—',
      },
      {
        accessorKey: 'doc_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.doc_date}</span>,
      },
      {
        accessorKey: 'total',
        header: t('total'),
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{t(`status_${row.original.status}`)}</Badge>,
      },
    ],
    [route, t, type]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t(`${type}.title`)}</h1>
        {/* نطاق العرض ظاهر في الشاشة نفسها — لا مخفيّاً في الإعدادات. */}
        <BranchViewToggle value={view} onChange={setView} />
        <Link href={`${route}/new`}>
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t(`${type}.create`)}
          </Button>
        </Link>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={t('search')}
        emptyLabel={t(`${type}.empty`)}
        exportName={route.slice(1)}
      />
    </div>
  );
}
