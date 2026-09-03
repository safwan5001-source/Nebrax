'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  type ColumnDef,
  type SortingState,
  functionalUpdate,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, Download } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD } from './ui/table';
import { ColumnLayoutMenu } from '@/components/data-explorer/column-layout-menu';
import { Button } from './ui/button';
import { EmptyState, ErrorState, LoadingState } from './nebrax/states';
import { MobileRecordItem, type MobileRecord } from './nebrax/mobile-record';
import { toCsv, downloadCsv } from '@/lib/export';
import { cn } from '@/lib/utils';
import { normalizeProtectedColumns, type DataTableColumnVisibilityControl } from '@/lib/data-explorer/table-layout';

type ColumnHideBelow = 'md' | 'lg' | 'xl';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    numeric?: boolean;
    /**
     * إخفاء بصري تحت هذا العرض (لا حذف من النموذج ولا من قائمة الأعمدة).
     * الجدول نفسه يظهر من `md`؛ `hideBelow: 'xl'` يُبقي الأعمدة الحرجة على اللوحي.
     */
    hideBelow?: ColumnHideBelow;
  }
}

/**
 * فرز خادميّ — حين تُمرَّر هذه الخاصية يصبح الخادم **مصدر الحقيقة الوحيد**
 * للفرز، ويُطفأ فرز TanStack المحلي.
 *
 * بلا هذا التمييز كانت الصفحة المقسَّمة خادمياً تحمل فرزين متعارضين: قائمة
 * الترتيب في الشريط تفرز الكتالوج كله على الخادم، ورأس العمود يفرز **الصفحة
 * المحمَّلة وحدها** — فيرى المستخدم «الأعلى سعراً» وهو أعلى ما في هذه الصفحة
 * فقط. الصفحات غير المقسَّمة لا تمرّر الخاصية فيبقى سلوكها كما هو.
 */
export interface ServerSortControl {
  /** قيمة الفرز الحالية: `name` تصاعدي، `-name` تنازلي، فراغ = الافتراضي. */
  value?: string | null;
  onChange: (value: string) => void;
  /** معرّفات الأعمدة التي يقبل الخادم الفرز بها؛ ما عداها غير قابل للفرز. */
  columns: string[];
}

/** تحديد صفوف للإجراءات الجماعية (التصدير مثلاً). */
export interface RowSelectionControl<T> {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  getRowId: (row: T) => string;
}

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
  /** يجعل الفرز خادمياً بالكامل — انظر `ServerSortControl`. */
  serverSort?: ServerSortControl;
  /** يضيف عمود تحديد للصفوف ويعيد المعرّفات المحدَّدة. */
  selection?: RowSelectionControl<T>;
  /** يتحكم اختيارياً في ظهور الأعمدة؛ الأعمدة المحمية لا تُخفى. */
  columnVisibility?: DataTableColumnVisibilityControl;
  /** يثبت رأس الجدول داخل حاوية التمرير عند الحاجة إلى مسح قوائم كثيفة. */
  stickyHeader?: boolean;
  /** تسمية وصول لحالة التحميل — إن غابت يبقى نص `nebrax.loading`. */
  loadingLabel?: string;
  /** تمييز صف نشط (معاينة مفتوحة مثلاً) دون فرض تحديد جماعي. */
  isRowActive?: (row: T) => boolean;
  /**
   * نقر الصف يفتح تفصيلاً/معاينة. يُتجاهل إن كان الهدف زراً أو رابطاً أو حقلاً
   * قائماً حتى لا تُسرَق إجراءات الصف. اختياري بالكامل — القوائم الأخرى بلا تغيير.
   */
  onRowClick?: (row: T) => void;
  /**
   * قائمة الأعمدة داخل شريط الجدول أو شريطه المختصر. الافتراضي `true` حتى
   * لا تتغيّر الشاشات الأخرى. قائمة الفواتير تمرّر `false` وتستضيف القائمة في شريطها.
   */
  showColumnMenu?: boolean;
}

function columnMeta(columnDef: { meta?: unknown }): { numeric?: boolean; hideBelow?: ColumnHideBelow } {
  if (!columnDef.meta || typeof columnDef.meta !== 'object') return {};
  return columnDef.meta as { numeric?: boolean; hideBelow?: ColumnHideBelow };
}

function isNumericColumn(columnDef: { meta?: unknown }): boolean {
  return Boolean(columnMeta(columnDef).numeric);
}

function hideBelowClass(hideBelow?: ColumnHideBelow): string | undefined {
  if (hideBelow === 'md') return 'hidden md:table-cell';
  if (hideBelow === 'lg') return 'hidden lg:table-cell';
  if (hideBelow === 'xl') return 'hidden xl:table-cell';
  return undefined;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('a, button, input, select, textarea, label, [role="menuitem"], [role="option"]'),
  );
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
  serverSort,
  selection,
  columnVisibility,
  stickyHeader = false,
  loadingLabel,
  isRowActive,
  onRowClick,
  showColumnMenu = true,
}: DataTableProps<T>) {
  const t = useTranslations('nebrax');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('');
  const globalFilter = searchValue ?? internalGlobalFilter;
  const setGlobalFilter = onSearchChange ?? setInternalGlobalFilter;

  // حالة الفرز الظاهرة في الرؤوس تُشتقّ من قيمة الخادم حين يقودها، فلا يظهر
  // سهمٌ يعد بترتيبٍ لم يُطلَب من الخادم.
  const serverSorting = useMemo<SortingState>(() => {
    const value = serverSort?.value ?? '';
    if (!value) return [];
    const desc = value.startsWith('-');
    return [{ id: desc ? value.slice(1) : value, desc }];
  }, [serverSort?.value]);
  const protectedColumnIds = columnVisibility?.protectedColumnIds;
  const visibleColumns = useMemo(
    () => normalizeProtectedColumns(columnVisibility?.value ?? {}, protectedColumnIds),
    [columnVisibility?.value, protectedColumnIds]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting: serverSort ? serverSorting : sorting, globalFilter, columnVisibility: visibleColumns },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: (updater) => {
      if (!columnVisibility) return;
      const next = functionalUpdate(updater, visibleColumns);
      columnVisibility.onChange(normalizeProtectedColumns(next, protectedColumnIds));
    },
    manualSorting: Boolean(serverSort),
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

  const canSort = (id: string): boolean =>
    serverSort ? serverSort.columns.includes(id) : true;
  const columnLayoutItems = columnVisibility
    ? table.getAllLeafColumns().map((column) => ({
        id: column.id,
        label: columnVisibility.labels?.[column.id] ?? headerLabels[column.id] ?? column.id,
        visible: column.getIsVisible(),
        canHide: !protectedColumnIds?.includes(column.id),
      }))
    : [];

  function toggleSort(id: string): void {
    if (!serverSort) return;
    const current = serverSort.value ?? '';
    serverSort.onChange(current === id ? `-${id}` : id);
  }

  const selectedSet = useMemo(() => new Set(selection?.selectedIds ?? []), [selection?.selectedIds]);
  const pageIds = useMemo(
    () => (selection ? rows.map((row) => selection.getRowId(row.original)) : []),
    [rows, selection]
  );
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  function toggleRow(id: string): void {
    if (!selection) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange([...next]);
  }

  function togglePage(): void {
    if (!selection) return;
    const next = new Set(selectedSet);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    selection.onChange([...next]);
  }

  const checkboxClass =
    'h-4 w-4 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

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
          {columnVisibility && showColumnMenu ? (
            // بطاقة الجوال المخصصة تبني حقولها خارج خلايا الجدول، فلا يجوز أن
            // نعرض لها متحكماً يوحي بأن إخفاء العمود سيخفي تلك الحقول.
            <div className={mobileRecord ? 'hidden md:block' : undefined}>
              <ColumnLayoutMenu
                items={columnLayoutItems}
                labels={{ columns: t('columns'), moveColumn: t('moveColumn'), moveUp: t('moveUp'), moveDown: t('moveDown') }}
                onReorder={() => {}}
                onVisibilityChange={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
                allowReorder={false}
              />
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className={columnVisibility ? '' : 'ms-auto'}
            onClick={exportCsv}
            disabled={loading || data.length === 0}
            title={t('exportCsv')}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
            CSV
          </Button>
        </div>
      ) : columnVisibility && showColumnMenu ? (
        <div className={cn('flex justify-end border-b border-border p-2', mobileRecord && 'hidden md:flex')}>
          <ColumnLayoutMenu
            items={columnLayoutItems}
            labels={{ columns: t('columns'), moveColumn: t('moveColumn'), moveUp: t('moveUp'), moveDown: t('moveDown') }}
            onReorder={() => {}}
            onVisibilityChange={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
            allowReorder={false}
          />
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={onRetry} retryLabel={retryLabel} surface="bare" />
      ) : loading ? (
        <LoadingState surface="bare" label={loadingLabel} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyLabel ?? t('noResults')} description={emptyDescription} action={emptyAction} surface="bare" />
      ) : (
        <>
          {/* الجدول يمرّر أفقياً داخل حاويته (لا على مستوى الصفحة) بدل أن تنضغط
              أعمدته: رأسٌ مكسور على سطرين وتاريخٌ ينقسم ليسا كثافةً بل ضوضاء. */}
          <div className="hidden md:block">
            <Table className="[&_th]:whitespace-nowrap">
              <THead className={stickyHeader ? 'sticky top-0 z-10 bg-surface' : undefined}>
                {table.getHeaderGroups().map((hg) => (
                  <TR key={hg.id}>
                    {selection ? (
                      <TH className="w-10">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={allPageSelected}
                          onChange={togglePage}
                          aria-label={t('selectAllRows')}
                        />
                      </TH>
                    ) : null}
                    {hg.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
                      const sortable = header.column.getCanSort() && canSort(header.column.id);
                      const meta = columnMeta(header.column.columnDef);
                      return (
                        <TH
                          key={header.id}
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                          className={cn(meta.numeric && 'text-end', hideBelowClass(meta.hideBelow))}
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={
                                serverSort
                                  ? () => toggleSort(header.column.id)
                                  : header.column.getToggleSortingHandler()
                              }
                              className={cn(
                                'inline-flex cursor-pointer select-none items-center gap-1 rounded transition-colors hover:text-text',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                                meta.numeric && 'w-full justify-end',
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
                {rows.map((row) => {
                  const rowId = selection?.getRowId(row.original);
                  const active = Boolean(isRowActive?.(row.original));
                  return (
                    <TR
                      key={row.id}
                      aria-selected={active || undefined}
                      data-state={active ? 'active' : undefined}
                      className={cn(
                        onRowClick && 'cursor-pointer',
                        active && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                      onClick={onRowClick ? (event) => {
                        if (isInteractiveTarget(event.target)) return;
                        onRowClick(row.original);
                      } : undefined}
                    >
                      {selection && rowId != null ? (
                        <TD className="w-10">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={selectedSet.has(rowId)}
                            onChange={() => toggleRow(rowId)}
                            aria-label={t('selectRow')}
                          />
                        </TD>
                      ) : null}
                      {row.getVisibleCells().map((cell) => (
                        <TD
                          key={cell.id}
                          className={cn(
                            isNumericColumn(cell.column.columnDef) && 'text-end',
                            hideBelowClass(columnMeta(cell.column.columnDef).hideBelow),
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TD>
                      ))}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) => {
              const rowId = selection?.getRowId(row.original);
              const body = mobileRecord ? (
                <MobileRecordItem record={mobileRecord(row.original)} />
              ) : (
                <div className="flex flex-col gap-1.5 p-3.5">
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
                </div>
              );

              const active = Boolean(isRowActive?.(row.original));
              return (
                <li
                  key={row.id}
                  aria-selected={active || undefined}
                  data-state={active ? 'active' : undefined}
                  className={cn(
                    onRowClick && 'cursor-pointer',
                    active && 'bg-primary-soft',
                  )}
                  onClick={onRowClick ? (event) => {
                    if (isInteractiveTarget(event.target)) return;
                    onRowClick(row.original);
                  } : undefined}
                >
                  {selection && rowId != null ? (
                    <div className="flex items-start gap-2">
                      <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center ps-2">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={selectedSet.has(rowId)}
                          onChange={() => toggleRow(rowId)}
                          aria-label={t('selectRow')}
                        />
                      </label>
                      <div className="min-w-0 flex-1">{body}</div>
                    </div>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
