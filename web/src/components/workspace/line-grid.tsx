'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAwjUi3 } from '@/lib/use-awj-ui3';

/**
 * LineGrid — the shared pattern for document lines (design-system/v3/DATA_GRID.md §1).
 *
 * It is NOT a DataTable with inputs: lines are edited in place, hold derived cells and
 * need document-level keyboard behaviour. It shares the visual language with DataTable
 * (density tokens, Band header, row states) but not its features (no server sort,
 * pagination, export).
 *
 * Two layers, one language:
 *  1. `LineGridView` — read-only lines of a document (posted or draft view). Columns carry
 *     a priority (p1 always, p2 ≥ md, p3 ≥ lg); a compact `mobileRow` renders below `md`.
 *  2. `LineGrid` / `LineGridHeader` / `LineGridRow` — the container, header band and row
 *     wrappers for the editable form. They add markers and keyboard shortcuts only: the
 *     cells, inputs, validation and calculations stay exactly where they are.
 *
 * No calculation lives here. Cells render the values the caller passes.
 */

export interface LineGridColumn<T> {
  id: string;
  header: React.ReactNode;
  align?: 'start' | 'end';
  priority?: 'p1' | 'p2' | 'p3';
  /** Derived cells (e.g. line total) show a lock — the value is computed, not entered. */
  derived?: boolean;
  className?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

const PRIORITY_CLASS = { p1: '', p2: 'hidden md:table-cell', p3: 'hidden lg:table-cell' } as const;

export function LineGridView<T>({
  columns,
  rows,
  getKey,
  ariaLabel,
  mobileRow,
  footerNote,
  emptyLabel,
}: {
  columns: LineGridColumn<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  ariaLabel: string;
  /** Compact line summary below `md`. When omitted the table scrolls horizontally. */
  mobileRow?: (row: T, index: number) => React.ReactNode;
  footerNote?: string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <p className="p-6 text-center text-sm text-secondary">{emptyLabel}</p>
    ) : null;
  }

  return (
    <div data-awj-linegrid-view-root="">
      {mobileRow ? (
        <ul aria-label={ariaLabel} className="divide-y divide-hairline md:hidden">
          {rows.map((row, index) => (
            <li key={getKey(row, index)} className="px-3 py-2.5">
              {mobileRow(row, index)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={cn('overflow-x-auto', mobileRow && 'hidden md:block')}>
        <table data-awj-linegrid-view="" aria-label={ariaLabel} className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(column.align === 'end' ? 'text-end' : 'text-start', PRIORITY_CLASS[column.priority ?? 'p1'], column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={getKey(row, index)}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(column.align === 'end' ? 'text-end' : 'text-start', PRIORITY_CLASS[column.priority ?? 'p1'], column.className)}
                  >
                    {column.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {footerNote ? (
        <p data-awj-linegrid-footer="" className="flex items-center gap-1.5 px-3 py-2 text-xs text-secondary">
          <Lock className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          {footerNote}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ editable layer */

/**
 * Container for editable lines. Under the v3 gate it adds document-level shortcuts:
 *  - `Alt+N`            add a line (calls `onAddLine`; the host keeps owning line state)
 *  - `Alt+↓` / `Alt+↑`  move to the same column in the next/previous line
 * Plain arrow keys are NOT intercepted: inside inputs they edit (numbers) and inside
 * comboboxes they pick options. Gate-off the container is an inert wrapper.
 */
export function LineGrid({
  onAddLine,
  className,
  children,
  ...rest
}: {
  onAddLine?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const v3 = useAwjUi3();

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    rest.onKeyDown?.(event);
    if (!v3 || event.defaultPrevented || !event.altKey) return;

    if (event.key.toLowerCase() === 'n' && onAddLine) {
      event.preventDefault();
      onAddLine();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-awj-col]');
    const row = target.closest<HTMLElement>('[data-awj-linegrid-row]');
    if (!cell || !row) return;

    const col = cell.dataset.awjCol;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-awj-linegrid-row]'));
    const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
    const focusable = next?.querySelector<HTMLElement>(
      `[data-awj-col="${col}"] :is(input, select, textarea, button, [tabindex]):not([disabled]):not([tabindex="-1"])`
    );
    if (focusable) {
      event.preventDefault();
      focusable.focus();
    }
  };

  return (
    <div
      {...rest}
      data-awj-linegrid=""
      className={className}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** Header band for the editable grid; hidden below the dense (`lg`) breakpoint like the legacy header. */
export function LineGridHeader({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-awj-linegrid-head="" className={className} {...rest}>
      {children}
    </div>
  );
}

/** One editable line. `invalid` marks a blocking problem on the row (the cell still owns its message). */
export function LineGridRow({
  invalid,
  className,
  children,
  ...rest
}: { invalid?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-awj-linegrid-row=""
      data-awj-invalid={invalid ? '' : undefined}
      data-awj-apex="row"
      className={className}
      {...rest}
    >
      {children}
    </div>
  );
}
