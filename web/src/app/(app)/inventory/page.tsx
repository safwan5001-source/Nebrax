'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { History } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { MovementsDialog } from '@/components/inventory/movements-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface StockItem {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  quantity_on_hand: number;
  avg_cost: string;
  stock_value: string;
}

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const [items, setItems] = useState<StockItem[]>([]);
  const [totalValue, setTotalValue] = useState('0');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api<{ data: StockItem[]; total_value: string }>('/inventory')
      .then((r) => {
        setItems(r.data);
        setTotalValue(r.total_value);
      })
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo<ColumnDef<StockItem, unknown>[]>(
    () => [
      { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num text-muted">{row.original.sku ?? '—'}</span> },
      { accessorKey: 'name', header: t('name') },
      { accessorKey: 'unit', header: t('unit'), cell: ({ row }) => <span className="text-muted">{row.original.unit}</span> },
      { accessorKey: 'quantity_on_hand', header: t('qty'), cell: ({ row }) => <div className="num text-end font-medium">{row.original.quantity_on_hand}</div> },
      { accessorKey: 'avg_cost', header: t('avg_cost'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.avg_cost)}</div> },
      { accessorKey: 'stock_value', header: t('stock_value'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.stock_value)}</div> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" aria-label={t('movements')} onClick={() => setActive({ id: row.original.id, name: row.original.name })}>
            <History className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="rounded border border-border bg-surface px-4 py-2 text-sm">
          <span className="text-muted">{t('total_value')}: </span>
          <span className="num font-semibold text-text">{formatRiyal(totalValue)}</span>
        </div>
      </div>

      <DataTable columns={columns} data={items} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="inventory" />

      <MovementsDialog product={active} onClose={() => setActive(null)} />
    </div>
  );
}
