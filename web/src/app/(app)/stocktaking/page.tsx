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

interface Stocktake {
  id: string;
  number: string;
  warehouse_name: string | null;
  stocktake_date: string;
  status: string;
  difference_value: string;
}

export default function StocktakingPage() {
  const t = useTranslations('stocktaking');
  const [data, setData] = useState<Stocktake[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Stocktake[] }>(`/stocktakes${branchViewQuery(view)}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Stocktake, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/stocktaking/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      { id: 'warehouse', header: t('warehouse'), accessorFn: (r) => r.warehouse_name ?? '—' },
      {
        accessorKey: 'stocktake_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.stocktake_date}</span>,
      },
      {
        accessorKey: 'difference_value',
        header: t('difference'),
        // الفرق موجبٌ زيادة وسالبٌ عجز — واللون يقرأ قبل الرقم.
        cell: ({ row }) => {
          const v = Number(String(row.original.difference_value).replace(/,/g, ''));
          return (
            <div className={`num text-end ${v < 0 ? 'text-negative' : v > 0 ? 'text-positive' : 'text-muted'}`}>
              {formatRiyal(row.original.difference_value)}
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => (
          <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{t(row.original.status)}</Badge>
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
        <Link href="/stocktaking/new">
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
        exportName="stocktaking"
      />
    </div>
  );
}
