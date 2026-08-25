'use client';

import { useState } from 'react';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, Download } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD } from './ui/table';
import { Button } from './ui/button';
import { EmptyState, ErrorState, LoadingState } from './nebrax/states';
import { MobileRecordItem, type MobileRecord } from './nebrax/mobile-record';
import { toCsv, downloadCsv } from '@/lib/export';
import { cn } from '@/lib/utils';

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  exportName?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  showToolbar?: boolean;
  /**
   * هرم سجلّ الجوال. حين يُمرَّر، تعرض الشاشات دون `md` بطاقة مرتّبة بالأهمية
   * بدل إسقاط كل خلية جدول كسطر «تسمية: قيمة». وحين لا يُمرَّر يبقى السلوك
   * القديم كما هو، فلا تتأثر عشرات الشاشات التي لم تُهاجر بعد.
   */
  mobileRecord?: (row: T) => MobileRecord;
  /** رسالة فشل الجلب — تُعرض مكان الجدول بحالة خطأ موحّدة. */
  error?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  searchPlaceholder,
  emptyLabel,
  emptyDescription,
  emptyAction,
  exportName,
  searchValue,
  onSearchChange,
  showToolbar = true,
  mobileRecord,
  error,
  onRetry,
  retryLabel,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('');
  const globalFilter = searchValue ?? internalGlobalFilter;
  const setGlobalFilter = onSearchChange ?? setInternalGlobalFilter;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function exportCsv() {
    const cols = table
      .getAllLeafColumns()
      .filter((c) => {
        const def = c.columnDef as { accessorKey?: unknown; accessorFn?: unknown };
        return def.accessorKey != null || def.accessorFn != null;
      });
    const headers = cols.map((c) => (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id));
    const rows = table.getFilteredRowModel().rows.map((r) =>
      cols.map((c) => r.getValue(c.id) as string | number | null | undefined)
    );
    downloadCsv(exportName ?? 'export', toCsv(headers, rows));
  }

  const rows = table.getRowModel().rows;
  const headerLabels: Record<string, string> = {};
  table.getAllLeafColumns().forEach((c) => {
    if (typeof c.columnDef.header === 'string') headerLabels[c.id] = c.columnDef.header;
  });

  return (
    <div className="rounded border border-border bg-surface">
      {showToolbar ? (
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="h-4 w-4 text-muted" strokeWidth={1.6} />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full max-w-xs bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
          />
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={exportCsv}
            disabled={loading || data.length === 0}
            title="تصدير CSV"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
            CSV
          </Button>
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={onRetry} retryLabel={retryLabel} surface="bare" />
      ) : loading ? (
        <LoadingState surface="bare" />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyLabel ?? 'لا توجد نتائج'} description={emptyDescription} action={emptyAction} surface="bare" />
      ) : (
        <>
          {/* الجدول يمرّر أفقياً داخل حاويته (لا على مستوى الصفحة) بدل أن تنضغط
              أعمدته: رأسٌ مكسور على سطرين وتاريخٌ ينقسم ليسا كثافةً بل ضوضاء. */}
          <div className="hidden md:block">
            <Table className="[&_th]:whitespace-nowrap">
              <THead>
                {table.getHeaderGroups().map((hg) => (
                  <TR key={hg.id}>
                    {hg.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
                      return (
                        <TH
                          key={header.id}
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                'inline-flex cursor-pointer select-none items-center gap-1 rounded transition-colors hover:text-text',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                                sorted && 'text-primary'
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <SortIcon
                                className={cn('h-3 w-3 transition-opacity', sorted ? 'opacity-100' : 'opacity-40')}
                                strokeWidth={1.7}
                              />
                            </button>
                          ) : (
                            <span className="inline-flex items-center">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                          )}
                        </TH>
                      );
                    })}
                  </TR>
                ))}
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) =>
              mobileRecord ? (
                <li key={row.id}>
                  <MobileRecordItem record={mobileRecord(row.original)} />
                </li>
              ) : (
                <li key={row.id} className="flex flex-col gap-1.5 p-3.5">
                  {row.getVisibleCells().map((cell) => {
                    const header = headerLabels[cell.column.id];
                    return (
                      <div key={cell.id} className="flex items-baseline justify-between gap-3">
                        {header ? <span className="shrink-0 text-xs text-muted">{header}</span> : <span />}
                        <span className="min-w-0 text-end text-sm">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      </div>
                    );
                  })}
                </li>
              )
            )}
          </ul>
        </>
      )}
    </div>
  );
}
