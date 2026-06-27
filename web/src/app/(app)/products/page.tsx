'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

export default function ProductsPage() {
  const t = useTranslations('products');
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Product[] }>('/products')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num text-muted">{row.original.sku ?? '—'}</span> },
      { accessorKey: 'name', header: t('name') },
      {
        accessorKey: 'type',
        header: t('type'),
        cell: ({ row }) => <Badge tone="muted">{t(row.original.type === 'service' ? 'service' : 'good')}</Badge>,
      },
      { accessorKey: 'sale_price', header: t('sale_price'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.sale_price)}</div> },
      { accessorKey: 'tax_rate', header: t('tax_rate'), cell: ({ row }) => <div className="num text-end">{row.original.tax_rate}%</div> },
      {
        id: 'stock',
        header: t('stock'),
        accessorFn: (r) => (r.track_inventory ? r.quantity_on_hand : ''),
        cell: ({ row }) => (
          <div className="num text-end">{row.original.track_inventory ? row.original.quantity_on_hand : '—'}</div>
        ),
      },
      {
        accessorKey: 'is_active',
        header: t('status_label'),
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(row.original); setDialog(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => { setEditing(null); setDialog(true); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('add')}
        </Button>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="products" />

      <ProductDialog open={dialog} onClose={() => setDialog(false)} onSaved={load} product={editing} />
    </div>
  );
}
