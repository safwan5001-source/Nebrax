import { cn } from '@/lib/utils';

export type BarRow = { key: string; label: string; count: number; valueText: string };

/**
 * Accessible count bars: every value is also printed as text (the bar is decoration, `aria-hidden`), one series,
 * one hue, length proportional to the largest count in the group. A group with no counts says so instead of
 * drawing empty bars.
 */
export function CountBars({ rows, emptyText, className }: { rows: BarRow[]; emptyText: string; className?: string }) {
  const max = Math.max(0, ...rows.map((row) => row.count));
  if (max === 0) return <p className="py-2 text-sm text-muted">{emptyText}</p>;

  return (
    <ul className={cn('space-y-2.5', className)}>
      {rows.map((row) => (
        <li key={row.key} data-testid="count-row">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-text">{row.label}</span>
            <span className="num shrink-0 font-medium text-text">{row.valueText}</span>
          </div>
          <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded bg-primary-soft">
            <div className="h-full rounded bg-primary" style={{ width: `${row.count === 0 ? 0 : Math.max(2, (row.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
