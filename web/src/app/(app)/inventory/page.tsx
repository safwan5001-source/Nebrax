'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Download, Eye, History } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MovementsDialog } from '@/components/inventory/movements-dialog';
import { InventoryExportDialog } from '@/components/inventory/inventory-export-dialog';
import type { InventoryExportState } from '@/modules/inventory/export-contract';
import {
  INVENTORY_WORKSPACE_COST_SORTS,
  INVENTORY_WORKSPACE_SORT_COLUMNS,
  inventoryWorkspacePath,
  stockStateLabel,
  type InventoryStockState,
  type InventoryWorkspaceMeta,
  type InventoryWorkspaceRow,
} from '@/modules/inventory/workspace-query';
import { api, ApiError } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface NamedEntity {
  id: string;
  name: string;
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

function stockTone(state: InventoryStockState): 'positive' | 'warning' | 'muted' | 'negative' {
  if (state === 'in_stock') return 'positive';
  if (state === 'low') return 'warning';
  if (state === 'negative') return 'negative';
  return 'muted';
}

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const tWarehouses = useTranslations('warehouses');
  const tProducts = useTranslations('products');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [rows, setRows] = useState<InventoryWorkspaceRow[]>([]);
  const [meta, setMeta] = useState<InventoryWorkspaceMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; name: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<NamedEntity[]>([]);
  const [branches, setBranches] = useState<NamedEntity[]>([]);
  const [categories, setCategories] = useState<NamedEntity[]>([]);

  const canViewCost = meta?.can_view_cost === true;

  const loadWorkspace = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: InventoryWorkspaceRow[]; meta?: InventoryWorkspaceMeta }>(inventoryWorkspacePath(explorer))
      .then((response) => {
        setRows(Array.isArray(response.data) ? response.data : []);
        setMeta(response.meta ?? null);
      })
      .catch((err) => {
        setRows([]);
        setMeta(null);
        setLoadError(err instanceof ApiError ? err.message : tCommon('loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [explorer, tCommon]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    api<{ data: NamedEntity[] }>('/warehouses').then((r) => setWarehouses(r.data ?? [])).catch(() => setWarehouses([]));
    api<{ data: NamedEntity[] }>('/branches').then((r) => setBranches(r.data ?? [])).catch(() => setBranches([]));
    api<{ data: NamedEntity[] }>('/product-categories').then((r) => setCategories(r.data ?? [])).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExplorer((current) => current.search === searchInput
        ? current
        : { ...current, search: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/inventory?${url.toString()}` : '/inventory', { scroll: false });
  }, [explorer, router]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    {
      key: 'warehouse_id',
      label: tWarehouses('name'),
      kind: 'select',
      quick: true,
      options: warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    },
    {
      key: 'branch_id',
      label: tWarehouses('branch'),
      kind: 'select',
      quick: true,
      options: branches.map((branch) => ({ value: branch.id, label: branch.name })),
    },
    {
      key: 'category_id',
      label: tProducts('category'),
      kind: 'select',
      options: categories.map((category) => ({ value: category.id, label: category.name })),
    },
    {
      key: 'stock_state',
      label: locale.startsWith('en') ? 'Stock state' : 'حالة المخزون',
      kind: 'select',
      options: (['in_stock', 'low', 'out', 'negative'] as InventoryStockState[]).map((value) => ({
        value,
        label: stockStateLabel(value, locale),
      })),
    },
  ], [warehouses, branches, categories, tWarehouses, tProducts, locale]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const exportState = useMemo<InventoryExportState>(() => ({
    search: explorer.search,
    sort: explorer.sort,
    filters: Object.fromEntries(
      explorer.filters
        .filter((filter) => !Array.isArray(filter.value))
        .map((filter) => [filter.key, String(filter.value)]),
    ),
  }), [explorer.filters, explorer.search, explorer.sort]);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const sortOptions = useMemo(() => {
    const options = [
      { value: 'name', label: t('name') },
      { value: 'sku', label: t('sku') },
      { value: 'warehouse', label: tWarehouses('name') },
      { value: '-quantity', label: locale.startsWith('en') ? 'Qty: high' : 'الكمية: الأعلى' },
      { value: 'quantity', label: locale.startsWith('en') ? 'Qty: low' : 'الكمية: الأقل' },
    ];
    if (canViewCost) {
      options.push(
        { value: '-avg_cost', label: locale.startsWith('en') ? 'Avg cost: high' : 'متوسط التكلفة: الأعلى' },
        { value: 'avg_cost', label: locale.startsWith('en') ? 'Avg cost: low' : 'متوسط التكلفة: الأقل' },
        { value: '-stock_value', label: locale.startsWith('en') ? 'Value: high' : 'قيمة المخزون: الأعلى' },
        { value: 'stock_value', label: locale.startsWith('en') ? 'Value: low' : 'قيمة المخزون: الأقل' },
      );
    }
    return options;
  }, [canViewCost, locale, t, tWarehouses]);

  useEffect(() => {
    const key = (explorer.sort ?? 'name').replace(/^-/, '');
    if (!canViewCost && INVENTORY_WORKSPACE_COST_SORTS.includes(key)) {
      setExplorer((current) => ({ ...current, sort: 'name', page: 1 }));
    }
  }, [canViewCost, explorer.sort]);

  const columns = useMemo<ColumnDef<InventoryWorkspaceRow, unknown>[]>(() => {
    const next: ColumnDef<InventoryWorkspaceRow, unknown>[] = [
      { accessorKey: 'sku', header: t('sku'), cell: ({ row }) => <span className="num text-muted">{row.original.sku ?? '—'}</span> },
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <Link href={`/products/${row.original.product_id}`} className="font-medium text-primary hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      { accessorKey: 'warehouse_name', header: tWarehouses('name') },
      {
        accessorKey: 'branch_name',
        header: tWarehouses('branch'),
        cell: ({ row }) => <span className="text-muted">{row.original.branch_name ?? tWarehouses('no_branch')}</span>,
      },
      { accessorKey: 'unit', header: t('unit'), cell: ({ row }) => <span className="text-muted">{row.original.unit}</span> },
      {
        accessorKey: 'quantity',
        header: t('qty'),
        cell: ({ row }) => <div className="num text-end font-medium">{row.original.quantity}</div>,
      },
      {
        accessorKey: 'stock_state',
        header: locale.startsWith('en') ? 'State' : 'الحالة',
        cell: ({ row }) => (
          <Badge tone={stockTone(row.original.stock_state)}>
            {stockStateLabel(row.original.stock_state, locale)}
          </Badge>
        ),
      },
    ];

    if (canViewCost) {
      next.push(
        {
          accessorKey: 'avg_cost',
          header: t('avg_cost'),
          cell: ({ row }) => <div className="num text-end">{row.original.avg_cost == null ? '—' : formatRiyal(row.original.avg_cost)}</div>,
        },
        {
          accessorKey: 'stock_value',
          header: t('stock_value'),
          cell: ({ row }) => <div className="num text-end">{row.original.stock_value == null ? '—' : formatRiyal(row.original.stock_value)}</div>,
        },
      );
    }

    next.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="icon" aria-label={tProducts('view')}>
            <Link href={`/products/${row.original.product_id}`}>
              <Eye className="h-4 w-4" strokeWidth={1.7} />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('movements')}
            onClick={() => setActive({ id: row.original.product_id, name: row.original.name })}
          >
            <History className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        </div>
      ),
    });

    return next;
  }, [canViewCost, locale, t, tWarehouses, tProducts]);

  const page = meta?.current_page ?? explorer.page ?? 1;
  const lastPage = meta?.last_page ?? 1;
  const perPage = meta?.per_page ?? explorer.perPage ?? 25;
  const total = meta?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded border border-border bg-surface px-4 py-2 text-sm">
            <span className="text-muted">{locale.startsWith('en') ? 'Total qty' : 'إجمالي الكمية'}: </span>
            <span className="num font-semibold text-text" data-testid="workspace-total-qty">
              {(meta?.total_quantity ?? 0).toLocaleString(locale.startsWith('en') ? 'en' : 'ar')}
            </span>
          </div>
          {canViewCost && meta?.total_value != null ? (
            <div className="rounded border border-border bg-surface px-4 py-2 text-sm" data-testid="workspace-total-value">
              <span className="text-muted">{t('total_value')}: </span>
              <span className="num font-semibold text-text">{formatRiyal(meta.total_value)}</span>
            </div>
          ) : null}
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {t('export')}
          </Button>
        </div>
      </div>

      <DataExplorerToolbar
        search={searchInput}
        searchPlaceholder={`${t('search')} · ${t('sku')} · ${t('name')}`}
        onSearchChange={setSearchInput}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        resultCount={rows.length}
        totalCount={total}
      />

      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted">{locale.startsWith('en') ? 'Sort by' : 'ترتيب حسب'}</span>
        <Select
          value={explorer.sort ?? 'name'}
          onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))}
          className="h-9 min-w-44 bg-surface text-sm"
          aria-label={locale.startsWith('en') ? 'Sort inventory' : 'ترتيب المخزون'}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={loadError}
        onRetry={loadWorkspace}
        emptyLabel={t('empty')}
        exportName="inventory-workspace"
        showToolbar={false}
        stickyHeader
        serverSort={{
          value: explorer.sort ?? 'name',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          columns: canViewCost
            ? INVENTORY_WORKSPACE_SORT_COLUMNS
            : INVENTORY_WORKSPACE_SORT_COLUMNS.filter((column) => !INVENTORY_WORKSPACE_COST_SORTS.includes(column)),
        }}
        mobileRecord={(row) => ({
          title: (
            <Link href={`/products/${row.product_id}`} className="text-primary hover:underline">
              {row.name}
            </Link>
          ),
          subtitle: [row.warehouse_name, row.branch_name].filter(Boolean).join(' · ') || tWarehouses('name'),
          amountLabel: t('qty'),
          amount: String(row.quantity),
          status: <Badge tone={stockTone(row.stock_state)}>{stockStateLabel(row.stock_state, locale)}</Badge>,
          meta: (
            <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
              {row.sku ? <span dir="ltr" className="num">{row.sku}</span> : null}
              {canViewCost && row.stock_value != null ? <span className="num">{formatRiyal(row.stock_value)}</span> : null}
            </span>
          ),
          actions: (
            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="icon" aria-label={tProducts('view')}>
                <Link href={`/products/${row.product_id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link>
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('movements')} onClick={() => setActive({ id: row.product_id, name: row.name })}>
                <History className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            </div>
          ),
        })}
      />

      <Pagination
        page={page}
        lastPage={lastPage}
        perPage={perPage}
        total={total}
        disabled={loading}
        onPageChange={(nextPage) => setExplorer((current) => ({ ...current, page: nextPage }))}
        onPerPageChange={(nextPerPage) => setExplorer((current) => ({ ...current, page: 1, perPage: nextPerPage }))}
      />

      <AdvancedFilterDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        definitions={definitions}
        filters={labelledFilters}
        onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))}
      />

      <InventoryExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        state={exportState}
        filteredCount={total}
        totalCount={total}
      />

      <MovementsDialog product={active} onClose={() => setActive(null)} />
    </div>
  );
}
