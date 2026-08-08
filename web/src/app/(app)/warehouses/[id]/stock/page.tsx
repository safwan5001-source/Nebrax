'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Warehouse, WarehouseStockRow } from '@/lib/warehouse';

/** أرصدة الكميات داخل مخزن — كمّي فقط (التقييم عالمي على المنتج). */
export default function WarehouseStockPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('warehouses');
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [rows, setRows] = useState<WarehouseStockRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ data: Warehouse }>(`/warehouses/${id}`),
      api<{ data: WarehouseStockRow[] }>(`/warehouses/${id}/stock`),
    ])
      .then(([w, s]) => { setWarehouse(w.data); setRows(s.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const columns = useMemo<ColumnDef<WarehouseStockRow, unknown>[]>(
    () => [
      { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num text-muted">{row.original.sku ?? '—'}</span> },
      { accessorKey: 'name', header: t('product') },
      { accessorKey: 'quantity', header: t('qty'), cell: ({ row }) => <div className="num text-end font-medium">{row.original.quantity}</div> },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/warehouses">
          <Button variant="ghost" size="icon" aria-label={t('title')}>
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('stock')}</h1>
          <p className="text-sm text-muted">{warehouse?.name ?? '—'}</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder={t('search_products')}
        emptyLabel={t('no_stock')}
        exportName="warehouse-stock"
      />
    </div>
  );
}
