'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Rows3,
  Search,
} from 'lucide-react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ReportCellTone = 'positive' | 'negative' | 'neutral';

export interface ReportRowAction {
  href: string;
  label: string;
}

export interface ReportDataColumn {
  id: string;
  label: string;
  align?: 'start' | 'end';
  numeric?: boolean;
  sortable?: boolean;
  hideable?: boolean;
  cellTone?: (value: string, row: string[], rowIndex: number) => ReportCellTone;
}

export interface ReportDataTableLabels {
  search: string;
  searchPlaceholder: string;
  columns: string;
  density: string;
  comfortable: string;
  compact: string;
  rowsPerPage: string;
  results: string;
  page: string;
  of: string;
  previous: string;
  next: string;
  noResults: string;
  openDetails: string;
}

export interface ReportDataTableProps {
  columns: ReportDataColumn[];
  rows: string[][];
  totalRow?: string[] | null;
  labels: ReportDataTableLabels;
  emptyText?: string;
  initialPageSize?: number;
  initialDensity?: 'comfortable' | 'compact';
  className?: string;
  primaryColumnId?: string;
  rowActions?: Array<ReportRowAction | null | undefined>;
}

interface DataRow {
  id: string;
  rowIndex: number;
  values: string[];
  cells: Record<string, string>;
}

function normalizeLocalizedDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - '٠'.charCodeAt(0)))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - '۰'.charCodeAt(0)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

function numericValue(value: string): number | null {
  const cleaned = normalizeLocalizedDigits(value)
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.\-]/g, '');

  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

export function reportCellToneFromValue(value: string): ReportCellTone {
  const numeric = numericValue(value);
  if (numeric === null || numeric === 0) return 'neutral';
  return numeric > 0 ? 'positive' : 'negative';
}

function isoDateValue(value: string): number | null {
  const match = normalizeLocalizedDigits(value).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(date) ? date : null;
}

function compareValues(a: string, b: string) {
  const aDate = isoDateValue(a);
  const bDate = isoDateValue(b);
  if (aDate !== null && bDate !== null) return aDate - bDate;

  const aNumber = numericValue(a);
  const bNumber = numericValue(b);
  if (aNumber !== null && bNumber !== null) return aNumber - bNumber;

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeSearchValue(value: string) {
  return normalizeLocalizedDigits(value).toLocaleLowerCase();
}

function compactSearchValue(value: string) {
  return normalizeSearchValue(value).replace(/[\s,،]/g, '');
}

export function defaultReportTableLabels(locale: string): ReportDataTableLabels {
  const ar = locale.toLowerCase().startsWith('ar');
  return ar
    ? {
        search: 'بحث في النتائج',
        searchPlaceholder: 'ابحث داخل التقرير…',
        columns: 'الأعمدة',
        density: 'كثافة الصفوف',
        comfortable: 'مريحة',
        compact: 'مضغوطة',
        rowsPerPage: 'صفوف الصفحة',
        results: 'نتيجة',
        page: 'صفحة',
        of: 'من',
        previous: 'السابق',
        next: 'التالي',
        noResults: 'لا توجد نتائج مطابقة للبحث.',
        openDetails: 'عرض التفاصيل',
      }
    : {
        search: 'Search results',
        searchPlaceholder: 'Search within this report…',
        columns: 'Columns',
        density: 'Row density',
        comfortable: 'Comfortable',
        compact: 'Compact',
        rowsPerPage: 'Rows per page',
        results: 'results',
        page: 'Page',
        of: 'of',
        previous: 'Previous',
        next: 'Next',
        noResults: 'No results match your search.',
        openDetails: 'View details',
      };
}

export function ReportDataTable({
  columns,
  rows,
  totalRow,
  labels,
  emptyText,
  initialPageSize = 25,
  initialDensity = 'compact',
  className,
  primaryColumnId,
  rowActions,
}: ReportDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [density, setDensity] = useState<'comfortable' | 'compact'>(initialDensity);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const data = useMemo<DataRow[]>(
    () => rows.map((row, rowIndex) => ({
      id: String(rowIndex),
      rowIndex,
      values: row,
      cells: Object.fromEntries(columns.map((column, columnIndex) => [column.id, row[columnIndex] ?? ''])),
    })),
    [columns, rows]
  );

  const tableColumns = useMemo<ColumnDef<DataRow>[]>(
    () => columns.map((column) => ({
      id: column.id,
      accessorFn: (row) => row.cells[column.id] ?? '',
      header: column.label,
      enableSorting: column.sortable !== false,
      enableHiding: column.hideable !== false,
      sortingFn: (rowA, rowB) => compareValues(
        String(rowA.getValue(column.id) ?? ''),
        String(rowB.getValue(column.id) ?? '')
      ),
    })),
    [columns]
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting, globalFilter, columnVisibility },
    initialState: { pagination: { pageSize: initialPageSize } },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = normalizeSearchValue(String(filterValue ?? '').trim());
      if (!query) return true;
      const compactQuery = compactSearchValue(query);
      return columns.some((column) => {
        const value = String(row.original.cells[column.id] ?? '');
        return normalizeSearchValue(value).includes(query) || compactSearchValue(value).includes(compactQuery);
      });
    },
    autoResetPageIndex: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setPageIndex(0);
  }, [rows, table]);

  const visibleColumns = table.getVisibleLeafColumns();
  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(table.getPageCount(), 1);
  const pageNumber = Math.min(table.getState().pagination.pageIndex + 1, pageCount);

  return (
    <section className={cn('min-w-0', className)} aria-label="report-data-table">
      <div className="no-print mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} />
          <Input
            value={globalFilter}
            onChange={(event) => {
              setGlobalFilter(event.target.value);
              table.setPageIndex(0);
            }}
            aria-label={labels.search}
            placeholder={labels.searchPlaceholder}
            className="ps-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Button variant="outline" size="sm" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((open) => !open)}>
              <Columns3 className="h-4 w-4" strokeWidth={1.7} />
              {labels.columns}
            </Button>
            {columnsOpen && (
              <div className="absolute end-0 z-30 mt-2 min-w-52 rounded border border-border bg-surface p-2 shadow-sm">
                <div className="space-y-1">
                  {table.getAllLeafColumns().map((column) => {
                    const definition = columns.find((item) => item.id === column.id);
                    if (!definition || !column.getCanHide()) return null;
                    return (
                      <label key={column.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm text-text hover:bg-primary-soft/50">
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                          className="h-4 w-4 accent-primary"
                        />
                        <span>{definition.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <label className="inline-flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-text">
            <Rows3 className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden />
            <span className="sr-only">{labels.density}</span>
            <Select value={density} onChange={(event) => setDensity(event.target.value as 'comfortable' | 'compact')} className="h-7 border-0 bg-transparent px-1 py-0 shadow-none focus:ring-0">
              <option value="compact">{labels.compact}</option>
              <option value="comfortable">{labels.comfortable}</option>
            </Select>
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface text-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const definition = columns.find((column) => column.id === header.column.id);
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                        className={cn(
                          'whitespace-nowrap px-3 text-start text-xs font-semibold',
                          density === 'compact' ? 'py-2' : 'py-3',
                          definition?.align === 'end' && 'text-end'
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            className={cn(
                              'inline-flex max-w-full items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                              definition?.align === 'end' && 'ms-auto'
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <ChevronsUpDown className={cn('h-3.5 w-3.5 shrink-0', sorted && 'text-primary')} strokeWidth={1.7} aria-hidden />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-sm text-muted">
                    {globalFilter ? labels.noResults : (emptyText ?? labels.noResults)}
                  </td>
                </tr>
              ) : table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-primary-soft/35">
                  {row.getVisibleCells().map((cell) => {
                    const definition = columns.find((column) => column.id === cell.column.id);
                    const value = String(cell.getValue() ?? '');
                    const tone = definition?.cellTone?.(value, row.original.values, row.original.rowIndex);
                    const rowAction = rowActions?.[row.original.rowIndex];
                    const canOpenDetails = cell.column.id === primaryColumnId && !!rowAction;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 text-text',
                          density === 'compact' ? 'py-2' : 'py-3',
                          definition?.align === 'end' && 'text-end',
                          definition?.numeric && 'num tabular-nums',
                          tone === 'positive' && 'text-positive',
                          tone === 'negative' && 'text-negative'
                        )}
                      >
                        {canOpenDetails ? (
                          <Link href={rowAction.href} prefetch={false} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                            {value || '—'}
                          </Link>
                        ) : (value || '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {totalRow && (
              <tfoot className="sticky bottom-0 border-t border-primary/20 bg-primary-soft font-semibold text-text">
                <tr>
                  {visibleColumns.map((column) => {
                    const columnIndex = columns.findIndex((definition) => definition.id === column.id);
                    const definition = columns[columnIndex];
                    const value = totalRow[columnIndex] ?? '—';
                    const tone = definition?.cellTone?.(value, totalRow, -1);
                    return (
                      <td
                        key={column.id}
                        className={cn(
                          'px-3',
                          density === 'compact' ? 'py-2' : 'py-3',
                          definition?.align === 'end' && 'text-end',
                          definition?.numeric && 'num tabular-nums',
                          tone === 'positive' && 'text-positive',
                          tone === 'negative' && 'text-negative'
                        )}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="no-print mt-3 flex flex-col gap-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span>{filteredCount} {labels.results}</span>
          <label className="inline-flex items-center gap-2">
            <span>{labels.rowsPerPage}</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onChange={(event) => {
                table.setPageSize(Number(event.target.value));
                table.setPageIndex(0);
              }}
              className="h-8 w-20 py-1 text-xs"
            >
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </Select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span>{labels.page} {pageNumber} {labels.of} {pageCount}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} aria-label={labels.previous}>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
            </Button>
            <Button variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} aria-label={labels.next}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
