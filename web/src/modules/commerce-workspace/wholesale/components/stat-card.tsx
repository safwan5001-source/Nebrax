import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Compact KPI tile. Shows a real value, a loading skeleton, or an explicit unavailable reason — never a placeholder
 * number. `value` is rendered as given (callers format; money stays minor-unit → display in the caller).
 */
export function StatCard({
  label,
  value,
  hint,
  loading = false,
  unavailable,
  href,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  /** When set, replaces the value with this text (permission denied / error / not applicable). */
  unavailable?: ReactNode;
  href?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-24 flex-col justify-between gap-2 rounded border border-border bg-surface p-3', className)} data-testid="stat-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {href}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : unavailable !== undefined ? (
        <p className="text-sm text-muted">{unavailable}</p>
      ) : (
        <p className="num text-2xl font-semibold leading-none text-text">{value}</p>
      )}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
