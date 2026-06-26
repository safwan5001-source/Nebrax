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
import { ArrowUpDown, Search, Download } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD } from './ui/table';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { toCsv, downloadCsv } from '@/lib/export';

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  exportName?: string;
}

export function DataTable<T>({ columns, data, loading, searchPlaceholder, emptyLabel, exportName }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

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

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-muted">{emptyLabel}</p>
      ) : (
        <>
          {/* جدول كامل على الشاشات المتوسطة فأكبر */}
          <div className="hidden md:block">
            <Table>
              <THead>
                {table.getHeaderGroups().map((hg) => (
                  <TR key={hg.id}>
                    {hg.headers.map((header) => (
                      <TH key={header.id}>
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-text"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && <ArrowUpDown className="h-3 w-3" strokeWidth={1.6} />}
                          </button>
                        )}
                      </TH>
                    ))}
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

          {/* بطاقات على الجوال (مبدأ التخطيط #6) */}
          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) => (
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
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
