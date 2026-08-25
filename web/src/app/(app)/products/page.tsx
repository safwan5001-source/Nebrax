'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { getShowStockQuantities } from '@/lib/inventory';
import { useToast } from '@/components/ui/toast';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface ProductCategory {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  products_count?: number;
}

const sortOptions: SortOption[] = [
  { value: 'name', label: 'الاسم: أ-ي' },
  { value: '-name', label: 'الاسم: ي-أ' },
  { value: 'sku', label: 'SKU' },
  { value: '-sale_price', label: 'سعر البيع: الأعلى' },
  { value: 'sale_price', label: 'سعر البيع: الأقل' },
  { value: '-purchase_price', label: 'سعر الشراء: الأعلى' },
  { value: '-quantity_on_hand', label: 'المخزون: الأعلى' },
  { value: 'quantity_on_hand', label: 'المخزون: الأقل' },
];

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function moneyMatches(value: number, filter?: ActiveFilter): boolean {
  if (!filter || Array.isArray(filter.value) || String(filter.value).trim() === '') return true;
  const target = Number(filter.value);
  if (!Number.isFinite(target)) return true;
  if (filter.operator === 'lte' || filter.operator === 'lt') return value <= target;
  if (filter.operator === 'eq') return value === target;
  return value >= target;
}

export default function ProductsPage() {
  const t = useTranslations('products');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error } = useToast();

  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [showStock, setShowStock] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([api<{ data: Product[] }>('/products'), api<{ data: ProductCategory[] }>('/product-categories')])
      .then(([products, productCategories]) => {
        setData(products.data);
        setCategories(productCategories.data);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('action_failed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => load(), [load]);
  useEffect(() => { getSystemTaxInclusive().then(setTaxInclusive).catch(() => {}); }, []);
  useEffect(() => { getShowStockQuantities().then(setShowStock).catch(() => {}); }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setExplorer((current) => (current.search === searchInput ? current : { ...current, search: searchInput, page: 1 })),
      300
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/products?${url}` : '/products', { scroll: false });
  }, [explorer, router]);

  const categoryNames = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.name])),
    [categories]
  );

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'category_id', label: 'التصنيف', kind: 'entity', quick: true,
      searchPlaceholder: 'ابحث باسم التصنيف',
      emptyText: 'لا يوجد تصنيف مطابق',
      options: categories.map((category) => ({
        value: category.id,
        label: category.name,
        sub: category.parent_id ? categoryNames[category.parent_id] : undefined,
        hint: category.products_count != null ? `${category.products_count} منتج` : undefined,
      })),
    },
    {
      key: 'type', label: t('type'), kind: 'select', quick: true,
      options: [{ value: 'good', label: t('good') }, { value: 'service', label: t('service') }],
    },
    {
      key: 'is_active', label: t('status_label'), kind: 'select', quick: true,
      options: [{ value: '1', label: t('active') }, { value: '0', label: t('inactive') }],
    },
    {
      key: 'stock_state', label: 'المخزون', kind: 'select',
      options: [
        { value: 'tracked', label: 'متتبع للمخزون' },
        { value: 'not_tracked', label: 'غير متتبع' },
        { value: 'low', label: 'منخفض' },
        { value: 'out', label: 'نفد المخزون' },
      ],
    },
    { key: 'sale_price', label: t('sale_price'), kind: 'money', operators: ['gte', 'lte', 'eq'] },
    { key: 'purchase_price', label: 'سعر الشراء', kind: 'money', operators: ['gte', 'lte', 'eq'] },
  ], [categories, categoryNames, t]);

  const labelledFilters = useMemo(
    () => explorer.filters.map((filter) => ({
      ...filter,
      label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
    })),
    [definitions, explorer.filters]
  );

  const filtered = useMemo(() => {
    const byKey = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    return data.filter((product) => {
      if (query && ![product.name, product.name_en, product.sku, product.barcode, product.category, product.brand]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(query)) return false;

      const category = byKey.get('category_id');
      if (category && !Array.isArray(category.value) && String(category.value) && product.category_id !== String(category.value)) return false;

      const type = byKey.get('type');
      if (type && !Array.isArray(type.value) && String(type.value) && product.type !== String(type.value)) return false;

      const active = byKey.get('is_active');
      if (active && !Array.isArray(active.value) && String(active.value) !== '' && product.is_active !== (String(active.value) === '1')) return false;

      const stock = byKey.get('stock_state');
      if (stock && !Array.isArray(stock.value) && String(stock.value)) {
        const state = String(stock.value);
        const quantity = Number(product.quantity_on_hand ?? 0);
        const reorder = Number(product.reorder_level ?? 0);
        if (state === 'tracked' && !product.track_inventory) return false;
        if (state === 'not_tracked' && product.track_inventory) return false;
        if (state === 'out' && (!product.track_inventory || quantity > 0)) return false;
        if (state === 'low' && (!product.track_inventory || quantity <= 0 || reorder <= 0 || quantity > reorder)) return false;
      }

      return moneyMatches(Number(product.sale_price), byKey.get('sale_price'))
        && moneyMatches(Number(product.purchase_price), byKey.get('purchase_price'));
    });
  }, [data, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((a, b) => {
      let left: string | number = '';
      let right: string | number = '';
      if (['sale_price', 'purchase_price', 'quantity_on_hand'].includes(key)) {
        left = Number(a[key as 'sale_price' | 'purchase_price' | 'quantity_on_hand'] ?? 0);
        right = Number(b[key as 'sale_price' | 'purchase_price' | 'quantity_on_hand'] ?? 0);
      } else if (key === 'sku') {
        left = a.sku ?? '';
        right = b.sku ?? '';
      } else {
        left = a.name ?? '';
        right = b.name ?? '';
      }
      const compared = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'ar');
      return desc ? -compared : compared;
    });
    return next;
  }, [explorer.sort, filtered]);

  const perPage = explorer.perPage ?? 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

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

  const rowActions = useCallback((product: Product) => {
    const working = workingId === product.id;
    return (
      <>
        <Button asChild type="button" variant="ghost" size="icon" aria-label={t('view')}>
          <Link href={`/products/${product.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t('edit')} disabled={working} onClick={() => { setEditing(product); setDialog(true); }}>
          <Pencil className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t('copy')} disabled={working} onClick={() => void copyProduct(product)}>
          <Copy className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t('delete')} disabled={working} onClick={() => void deleteProduct(product)}>
          <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
        </Button>
      </>
    );
  }, [t, workingId]);

  const columns = useMemo<ColumnDef<Product, unknown>[]>(() => [
    { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num whitespace-nowrap text-muted">{row.original.sku ?? '—'}</span> },
    {
      accessorKey: 'name', header: t('name'),
      // كما في الفواتير: سطر واحد بحدٍّ أقصى، والنص كاملٌ في الـ DOM وفي `title`.
      cell: ({ row }) => (
        <Link href={`/products/${row.original.id}`} title={row.original.name} className="block max-w-64 truncate font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: 'type', header: t('type'), cell: ({ row }) => <Badge tone="muted">{t(row.original.type === 'service' ? 'service' : 'good')}</Badge> },
    {
      accessorKey: 'sale_price',
      header: `${t('sale_price')} · ${taxInclusive ? t('tax_incl_tag') : t('tax_excl_tag')}`,
      cell: ({ row }) => <div className="num whitespace-nowrap text-end">{formatRiyal(row.original.sale_price)}</div>,
    },
    { accessorKey: 'barcode', header: t('barcode'), cell: ({ row }) => <span className="num whitespace-nowrap text-muted" dir="ltr">{row.original.barcode ?? '—'}</span> },
    ...(showStock
      ? [{
          id: 'stock',
          header: t('stock'),
          accessorFn: (row: Product) => (row.track_inventory ? row.quantity_on_hand : ''),
          cell: ({ row }: { row: { original: Product } }) => (
            <div className="num whitespace-nowrap text-end">{row.original.track_inventory ? row.original.quantity_on_hand : '—'}</div>
          ),
        } as ColumnDef<Product, unknown>]
      : []),
    { accessorKey: 'is_active', header: t('status_label'), cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge> },
    { id: 'actions', header: '', cell: ({ row }) => <div className="flex items-center justify-end gap-1">{rowActions(row.original)}</div> },
  ], [rowActions, showStock, t, taxInclusive]);

  const headerActions: PageAction[] = [
    { key: 'import', label: t('import'), icon: Upload, href: '/products/import', variant: 'outline', emphasis: 'secondary' },
    { key: 'add', label: t('add'), icon: Plus, href: '/products/new', variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={headerActions} />

      <ListToolbar
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={`${t('search')} · SKU · ${t('barcode')}`}
        searchLabel={t('title')}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        sort={{
          value: explorer.sort ?? 'name',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          options: sortOptions,
          label: 'ترتيب المنتجات',
        }}
        resultCount={sorted.length}
        totalCount={data.length}
        countUnit="منتج"
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        error={loadError}
        onRetry={load}
        emptyLabel={t('empty')}
        exportName="products"
        showToolbar={false}
        mobileRecord={(product) => ({
          title: (
            <Link href={`/products/${product.id}`} className="text-primary hover:underline">
              {product.name}
            </Link>
          ),
          subtitle: (product.category_id ? categoryNames[product.category_id] : null) ?? product.category ?? '—',
          amountLabel: taxInclusive ? t('tax_incl_tag') : t('tax_excl_tag'),
          amount: formatRiyal(product.sale_price),
          secondary: showStock && product.track_inventory
            ? { label: t('stock'), value: product.quantity_on_hand }
            : undefined,
          status: (
            <>
              <Badge tone="muted">{t(product.type === 'service' ? 'service' : 'good')}</Badge>
              <Badge tone={product.is_active ? 'positive' : 'muted'}>{product.is_active ? t('active') : t('inactive')}</Badge>
            </>
          ),
          meta: product.sku ?? product.barcode ?? undefined,
          actions: rowActions(product),
        })}
      />

      <Pagination
        page={page}
        lastPage={totalPages}
        perPage={perPage}
        total={sorted.length}
        totalUnit="منتج"
        disabled={loading}
        onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
        onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))}
      />

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />

      <ProductDialog key={editing?.id ?? 'new'} open={dialog} onClose={() => setDialog(false)} onSaved={load} product={editing} />
    </div>
  );
}
