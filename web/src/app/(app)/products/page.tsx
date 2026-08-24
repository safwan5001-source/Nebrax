'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { getShowStockQuantities } from '@/lib/inventory';
import { useToast } from '@/components/ui/toast';

export default function ProductsPage() {
  const t = useTranslations('products');
  const { success, error } = useToast();
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [showStock, setShowStock] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Product[] }>('/products')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => { getSystemTaxInclusive().then(setTaxInclusive).catch(() => {}); }, []);
  useEffect(() => { getShowStockQuantities().then(setShowStock).catch(() => {}); }, []);

  async function copyProduct(product: Product) {
    setWorkingId(product.id);
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name: `${product.name} — ${t('copy')}`,
          name_en: product.name_en,
          sku: null,
          barcode: null,
          type: product.type,
          unit: product.unit,
          description: product.description,
          category_id: product.category_id,
          brand_id: product.brand_id,
          unit_template_id: product.unit_template_id,
          reorder_level: product.reorder_level,
          min_sale_price: product.min_sale_price ? Math.round(Number(product.min_sale_price) * 100) : null,
          discount: product.discount,
          discount_type: product.discount_type,
          profit_margin: product.profit_margin,
          tags: product.tags,
          internal_notes: product.internal_notes,
          sales_account_id: product.sales_account_id,
          cogs_account_id: product.cogs_account_id,
          sale_price: Math.round(Number(product.sale_price) * 100),
          purchase_price: Math.round(Number(product.purchase_price) * 100),
          tax_rate: product.tax_rate,
          track_inventory: product.track_inventory,
          initial_quantity: 0,
          is_active: product.is_active,
        },
      });
      success(t('copy_success'));
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setWorkingId(null);
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(t('delete_confirm', { name: product.name }))) return;
    setWorkingId(product.id);
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      success(t('delete_success'));
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setWorkingId(null);
    }
  }

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
      { accessorKey: 'barcode', header: t('barcode'), cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.barcode ?? '—'}</span> },
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
        cell: ({ row }) => {
          const product = row.original;
          const working = workingId === product.id;
          return (
            <div className="flex items-center justify-end gap-1">
              <Link href={`/products/${product.id}`}>
                <Button type="button" variant="ghost" size="icon" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button>
              </Link>
              <Button type="button" variant="ghost" size="icon" aria-label={t('edit')} disabled={working} onClick={() => { setEditing(product); setDialog(true); }}>
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t('copy')} disabled={working} onClick={() => void copyProduct(product)}>
                <Copy className="h-4 w-4" strokeWidth={1.7} />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t('delete')} disabled={working} onClick={() => void deleteProduct(product)}>
                <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
              </Button>
            </div>
          );
        },
      },
    ],
    [t, taxInclusive, showStock, workingId]
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

      <ProductDialog key={editing?.id ?? 'new'} open={dialog} onClose={() => setDialog(false)} onSaved={load} product={editing} />
    </div>
  );
}
