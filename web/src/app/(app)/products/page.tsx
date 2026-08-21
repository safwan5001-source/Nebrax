'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { getShowStockQuantities } from '@/lib/inventory';

export default function ProductsPage() {
  const t = useTranslations('products');
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [showStock, setShowStock] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Product[] }>('/products')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => { getSystemTaxInclusive().then(setTaxInclusive).catch(() => {}); }, []);
  useEffect(() => { getShowStockQuantities().then(setShowStock).catch(() => {}); }, []);

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num text-muted">{row.original.sku ?? '—'}</span> },
      { accessorKey: 'name', header: t('name'), cell: ({ row }) => <Link href={`/products/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.name}</Link> },
      {
        accessorKey: 'type',
        header: t('type'),
        cell: ({ row }) => <Badge tone="muted">{t(row.original.type === 'service' ? 'service' : 'good')}</Badge>,
      },
      {
        accessorKey: 'sale_price',
        header: `${t('sale_price')} · ${taxInclusive ? t('tax_incl_tag') : t('tax_excl_tag')}`,
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.sale_price)}</div>,
      },
      { accessorKey: 'tax_rate', header: t('tax_rate'), cell: ({ row }) => <div className="num text-end">{row.original.tax_rate}%</div> },
      // عمود الكمية يخضع لتفضيل «عرض الكميات» في إعدادات المخزون — عرضٌ بحت.
      ...(showStock
        ? ([{
            id: 'stock',
            header: t('stock'),
            accessorFn: (r: Product) => (r.track_inventory ? r.quantity_on_hand : ''),
            cell: ({ row }) => (
              <div className="num text-end">{row.original.track_inventory ? row.original.quantity_on_hand : '—'}</div>
            ),
          }] as ColumnDef<Product, unknown>[])
        : []),
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
    [t, taxInclusive, showStock]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/products/import">
            <Button variant="outline">
              <Upload className="h-4 w-4" strokeWidth={1.7} />
              {t('import')}
            </Button>
          </Link>
          <Link href="/products/new">
            <Button>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('add')}
            </Button>
          </Link>
        </div>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="products" />

      {/* key يعيد تركيب الحوار عند تغيّر الهدف — وإلا بقي النموذج على حالته الأولى (فارغاً) وكتبها فوق البيانات */}
      <ProductDialog key={editing?.id ?? 'new'} open={dialog} onClose={() => setDialog(false)} onSaved={load} product={editing} />
    </div>
  );
}
