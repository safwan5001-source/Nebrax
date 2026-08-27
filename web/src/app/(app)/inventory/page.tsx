'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Download, History } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MovementsDialog } from '@/components/inventory/movements-dialog';
import { InventoryExportDialog } from '@/components/inventory/inventory-export-dialog';
import type { InventoryExportState } from '@/modules/inventory/export-contract';
import { api } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
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

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<StockItem[]>([]);
  const [totalValue, setTotalValue] = useState('0');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{ id: string; name: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'name' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);

  useEffect(() => {
    api<{ data: StockItem[]; total_value: string }>('/inventory')
      .then((r) => {
        setItems(r.data);
        setTotalValue(r.total_value);
      })
      .finally(() => setLoading(false));
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

  const unitOptions = useMemo(() => Array.from(new Set(items.map((item) => item.unit).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'ar'))
    .map((value) => ({ value, label: value })), [items]);

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'unit', label: t('unit'), kind: 'select', quick: true, options: unitOptions },
    { key: 'qty_min', label: `${t('qty')} — الحد الأدنى`, kind: 'number' },
    { key: 'qty_max', label: `${t('qty')} — الحد الأعلى`, kind: 'number' },
    { key: 'avg_cost_min', label: `${t('avg_cost')} — الحد الأدنى`, kind: 'money' },
    { key: 'avg_cost_max', label: `${t('avg_cost')} — الحد الأعلى`, kind: 'money' },
    { key: 'stock_value_min', label: `${t('stock_value')} — الحد الأدنى`, kind: 'money' },
    { key: 'stock_value_max', label: `${t('stock_value')} — الحد الأعلى`, kind: 'money' },
  ], [t, unitOptions]);

  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({
    ...filter,
    label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
  })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const unit = filterValue(filters.get('unit'));
    const qtyMinValue = filterValue(filters.get('qty_min'));
    const qtyMaxValue = filterValue(filters.get('qty_max'));
    const avgCostMinValue = filterValue(filters.get('avg_cost_min'));
    const avgCostMaxValue = filterValue(filters.get('avg_cost_max'));
    const stockValueMinValue = filterValue(filters.get('stock_value_min'));
    const stockValueMaxValue = filterValue(filters.get('stock_value_max'));
    const qtyMin = Number(qtyMinValue);
    const qtyMax = Number(qtyMaxValue);
    const avgCostMin = Number(avgCostMinValue);
    const avgCostMax = Number(avgCostMaxValue);
    const stockValueMin = Number(stockValueMinValue);
    const stockValueMax = Number(stockValueMaxValue);

    return items.filter((item) => {
      if (query) {
        const haystack = [item.sku, item.name, item.unit]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (unit && item.unit !== unit) return false;
      if (qtyMinValue && Number.isFinite(qtyMin) && item.quantity_on_hand < qtyMin) return false;
      if (qtyMaxValue && Number.isFinite(qtyMax) && item.quantity_on_hand > qtyMax) return false;

      const avgCost = Number(item.avg_cost);
      if (avgCostMinValue && Number.isFinite(avgCostMin) && avgCost < avgCostMin) return false;
      if (avgCostMaxValue && Number.isFinite(avgCostMax) && avgCost > avgCostMax) return false;

      const stockValue = Number(item.stock_value);
      if (stockValueMinValue && Number.isFinite(stockValueMin) && stockValue < stockValueMin) return false;
      if (stockValueMaxValue && Number.isFinite(stockValueMax) && stockValue > stockValueMax) return false;
      return true;
    });
  }, [explorer.filters, explorer.search, items]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? 'name';
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'sku') comparison = (left.sku ?? '').localeCompare(right.sku ?? '', 'ar', { numeric: true });
      else if (key === 'unit') comparison = left.unit.localeCompare(right.unit, 'ar');
      else if (key === 'quantity_on_hand') comparison = left.quantity_on_hand - right.quantity_on_hand;
      else if (key === 'avg_cost') comparison = Number(left.avg_cost) - Number(right.avg_cost);
      else if (key === 'stock_value') comparison = Number(left.stock_value) - Number(right.stock_value);
      else comparison = left.name.localeCompare(right.name, 'ar');
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered]);

  // حالة التصدير من نفس مرشّحات الشاشة — فما يُصدَّر هو ما يُعرض.
  const exportState = useMemo<InventoryExportState>(() => ({
    search: explorer.search,
    sort: explorer.sort,
    filters: Object.fromEntries(
      explorer.filters
        .filter((filter) => !Array.isArray(filter.value))
        .map((filter) => [filter.key, String(filter.value)])
    ),
  }), [explorer.filters, explorer.search, explorer.sort]);

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
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded border border-border bg-surface px-4 py-2 text-sm">
            <span className="text-muted">{t('total_value')}: </span>
            <span className="num font-semibold text-text">{formatRiyal(totalValue)}</span>
          </div>
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
        resultCount={sorted.length}
        totalCount={items.length}
      />

      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted">ترتيب حسب</span>
        <Select value={explorer.sort ?? 'name'} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, sort: event.target.value }))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب المخزون">
          <option value="name">الاسم</option>
          <option value="sku">رمز SKU</option>
          <option value="unit">الوحدة</option>
          <option value="-quantity_on_hand">الكمية: الأعلى</option>
          <option value="quantity_on_hand">الكمية: الأقل</option>
          <option value="-avg_cost">متوسط التكلفة: الأعلى</option>
          <option value="avg_cost">متوسط التكلفة: الأقل</option>
          <option value="-stock_value">قيمة المخزون: الأعلى</option>
          <option value="stock_value">قيمة المخزون: الأقل</option>
        </Select>
      </div>

      <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="inventory" showToolbar={false} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p>
        <div className="flex items-center gap-2">
          <Select value={String(perPage)} onChange={(event) => setExplorer((current) => ({ ...current, page: 1, perPage: Number(event.target.value) }))} className="h-9 w-24 bg-surface text-sm" aria-label="عدد النتائج في الصفحة">
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </Select>
          <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading || page <= 1} onClick={() => setExplorer((current) => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronRight className="h-4 w-4" strokeWidth={1.7} /></Button>
          <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading || page >= totalPages} onClick={() => setExplorer((current) => ({ ...current, page: Math.min(totalPages, page + 1) }))}><ChevronLeft className="h-4 w-4" strokeWidth={1.7} /></Button>
        </div>
      </div>

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
        filteredCount={sorted.length}
        totalCount={items.length}
      />

      <MovementsDialog product={active} onClose={() => setActive(null)} />
    </div>
  );
}
