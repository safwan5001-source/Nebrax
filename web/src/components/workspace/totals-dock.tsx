'use client';

import * as React from 'react';
import { ChevronUp } from 'lucide-react';
import { Money } from '@/components/ui/money';
import { cn } from '@/lib/utils';

/**
 * Totals Dock (design-system/v3/TOTALS_DOCK.md).
 *
 * A docked summary at the bottom of the work area: component cells at the start, the
 * final amount on the Outcome surface at the end. It PRESENTS values the document
 * already holds (the API's stored totals, or — in an editor — the figures the form's
 * existing calculation produced). It never computes, rounds or reinterprets a total.
 *
 * - `cells` is the ordered list of components to show. Up to `maxInline` are shown on
 *   wide screens; the rest — and every cell below `md` — live in the "detail" popover.
 *   No horizontal scrolling inside the dock, and no figure is ever dropped.
 * - The dock carries no primary action (the single primary action lives in the command
 *   bar) — only informational links via `outcome.note`.
 * - `aria-live` on the outcome announces changes politely.
 */
export interface DockCell {
  key: string;
  label: string;
  /** Raw value as the source returns it (decimal string/number); formatted by <Money>. */
  value: string | number | null | undefined;
}

export function TotalsDock({
  ariaLabel,
  cells,
  outcome,
  detailLabel,
  maxInline = 4,
  variant = 'document',
  className,
}: {
  ariaLabel: string;
  cells: DockCell[];
  outcome: { label: string; value: string | number | null | undefined; note?: React.ReactNode };
  detailLabel: string;
  maxInline?: number;
  /**
   * `document` docks to the bottom of the work area (viewing a document). `editor` docks the
   * same way on desktop but flows in place below `lg`, where the form's own action bar is fixed
   * at the bottom of the screen.
   */
  variant?: 'document' | 'editor';
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLElement>(null);
  const popoverId = React.useId();
  const inline = cells.slice(0, maxInline);
  const hasOverflow = cells.length > maxInline;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <section
      ref={rootRef}
      role="region"
      aria-label={ariaLabel}
      data-awj-dock=""
      data-awj-dock-editor={variant === 'editor' ? '' : undefined}
      className={cn('no-print relative flex items-stretch', className)}
    >
      <dl data-awj-dock-cells="" className="flex min-w-0 flex-1 items-center">
        {inline.map((cell) => (
          <div key={cell.key} data-awj-dock-cell="" className="hidden min-w-0 md:block">
            <dt>{cell.label}</dt>
            <dd>
              <Money value={cell.value} />
            </dd>
          </div>
        ))}
        <div data-awj-dock-cell="" className={cn('min-w-0', !hasOverflow && 'md:hidden')}>
          <dt className="sr-only">{detailLabel}</dt>
          <dd>
            <button
              type="button"
              data-awj-dock-detail=""
              aria-expanded={open}
              aria-controls={popoverId}
              onClick={() => setOpen((value) => !value)}
            >
              {detailLabel}
              <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', !open && 'rotate-180')} strokeWidth={2} aria-hidden="true" />
            </button>
          </dd>
        </div>
      </dl>

      <div data-awj-dock-outcome="" data-awj-surface="outcome">
        <div data-awj-dock-outcome-label="">{outcome.label}</div>
        <div data-awj-dock-outcome-value="" aria-live="polite">
          <Money value={outcome.value} />
        </div>
        {outcome.note ? <div data-awj-dock-outcome-note="">{outcome.note}</div> : null}
      </div>

      {open ? (
        <div id={popoverId} role="group" aria-label={detailLabel} data-awj-dock-popover="">
          <dl>
            {cells.map((cell) => (
              <div key={cell.key}>
                <dt>{cell.label}</dt>
                <dd>
                  <Money value={cell.value} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
