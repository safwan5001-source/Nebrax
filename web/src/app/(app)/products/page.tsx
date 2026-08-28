'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Download, Eye, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { ProductExportDialog } from '@/components/products/product-export-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { getShowStockQuantities } from '@/lib/inventory';
import { useToast } from '@/components/ui/toast';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { PRODUCT_SORT_COLUMNS, productFilterQuery, productQuery } from '@/modules/products/list-query';
import { useDataTableColumnVisibility } from '@/lib/data-explorer/table-layout';

interface ProductCategory {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  products_count?: number;
}

interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
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
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [showStock, setShowStock] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const storedColumnVisibility = useDataTableColumnVisibility('products');
  const columnVisibility = useMemo(() => ({
    ...storedColumnVisibility,
    protectedColumnIds: ['name', 'actions'],
    labels: { actions: t('actions') },
  }), [storedColumnVisibility, t]);

  const loadProducts = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const query = productQuery(explorer);
    api<{ data: Product[]; meta?: PaginationMeta }>(`/products?${query}`)
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setData(rows);
        setPagination(response.meta ?? {
          current_page: 1,
          last_page: 1,
          per_page: explorer.perPage ?? 25,
          total: rows.length,
        });
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('action_failed')))
      .finally(() => setLoading(false));
  }, [explorer, t]);

  // التحديد يخصّ نتيجة بحثٍ بعينها: إبقاؤه بعد تغيّر الفلاتر كان سيصدّر
  // منتجاتٍ لم تعد ظاهرة أمام المستخدم أصلاً.
  const filterQuery = useMemo(() => productFilterQuery(explorer), [explorer]);
  useEffect(() => { setSelectedIds([]); }, [filterQuery]);

  const load = useCallback(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    api<{ data: ProductCategory[] }>('/product-categories')
      .then((response) => setCategories(response.data))
      .catch(() => setCategories([]));
  }, []);
  useEffect(() => loadProducts(), [loadProducts]);
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
          id: 'quantity_on_hand',
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
    { key: 'export', label: t('export'), icon: Download, onClick: () => setExportOpen(true), variant: 'outline', emphasis: 'secondary' },
    { key: 'import', label: t('import'), icon: Upload, href: '/products/import', variant: 'outline', emphasis: 'secondary' },
    { key: 'add', label: t('add'), icon: Plus, href: '/products/new', variant: 'primary' },
  ];

  const page = pagination?.current_page ?? explorer.page ?? 1;
  const perPage = pagination?.per_page ?? explorer.perPage ?? 25;
  const total = pagination?.total ?? data.length;
  const lastPage = pagination?.last_page ?? 1;

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
        }}
        resultCount={data.length}
        totalCount={total}
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm">
          <span className="num text-text">{t('selected_count', { count: selectedIds.length })}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            {t('clear_selection')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="ms-auto" onClick={() => setExportOpen(true)}>
            <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
            {t('export')}
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={loadError}
        onRetry={load}
        emptyLabel={t('empty')}
        showToolbar={false}
        serverSort={{
          value: explorer.sort ?? 'name',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          columns: PRODUCT_SORT_COLUMNS,
        }}
        selection={{
          selectedIds,
          onChange: setSelectedIds,
          getRowId: (product) => product.id,
        }}
        columnVisibility={columnVisibility}
        stickyHeader
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
          meta: product.sku || product.barcode ? (
            <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
              {product.sku ? (
                <span>
                  <span className="font-sans">{t('sku')}</span>{' '}
                  <span dir="ltr">{product.sku}</span>
                </span>
              ) : null}
              {product.barcode ? (
                <span>
                  <span className="font-sans">{t('barcode')}</span>{' '}
                  <span dir="ltr">{product.barcode}</span>
                </span>
              ) : null}
            </span>
          ) : undefined,
          actions: rowActions(product),
        })}
      />

      <Pagination
        page={page}
        lastPage={lastPage}
        perPage={perPage}
        total={total}
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

      <ProductExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filterQuery={filterQuery}
        selectedIds={selectedIds}
        filteredTotal={total}
      />

      <ProductDialog key={editing?.id ?? 'new'} open={dialog} onClose={() => setDialog(false)} onSaved={load} product={editing} />
    </div>
  );
}
