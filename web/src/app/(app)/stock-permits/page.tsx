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

interface StockPermit {
  id: string;
  type: 'receipt' | 'issue' | 'transfer';
  number: string;
  warehouse_name: string | null;
  target_warehouse_name: string | null;
  permit_date: string;
  status: string;
  reason: string | null;
  total_cost: string;
}

const typeTone: Record<StockPermit['type'], 'positive' | 'muted' | 'negative'> = {
  receipt: 'positive',
  issue: 'negative',
  transfer: 'muted',
};

/** أذون المخزن — إضافة · صرف · تحويل. الترحيل يحرّك المخزون ويولّد القيد معاً. */
export default function StockPermitsPage() {
  const t = useTranslations('stockPermits');
  const [data, setData] = useState<StockPermit[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: StockPermit[] }>(`/stock-permits${branchViewQuery(view)}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<StockPermit, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/stock-permits/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'type',
        header: t('type'),
        cell: ({ row }) => <Badge tone={typeTone[row.original.type]}>{t(`type_${row.original.type}`)}</Badge>,
      },
      {
        id: 'warehouse',
        header: t('warehouse'),
        accessorFn: (r) => r.warehouse_name ?? '—',
        cell: ({ row }) => (
          <span className="text-text">
            {row.original.warehouse_name ?? '—'}
            {row.original.target_warehouse_name && (
              <span className="text-muted"> ← {row.original.target_warehouse_name}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'permit_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.permit_date}</span>,
      },
      {
        accessorKey: 'total_cost',
        header: t('total_cost'),
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total_cost)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>
            {t(row.original.status)}
          </Badge>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <BranchViewToggle value={view} onChange={setView} />
        <Link href="/stock-permits/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={t('search')}
        emptyLabel={t('empty')}
        exportName="stock-permits"
      />
    </div>
  );
}
