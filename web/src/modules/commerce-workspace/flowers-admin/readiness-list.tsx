'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ReadinessItem = { key: string; done: boolean; label: ReactNode; action?: ReactNode };

/**
 * شروط أساسية بحالتها الحقيقية: الأيقونة والنص كلاهما يحملان المعنى (لا لون وحده). `statusLabels` نصوص قارئ
 * الشاشة لكل حالة.
 */
export function ReadinessList({
  items,
  statusLabels,
  className,
  ...rest
}: {
  items: ReadinessItem[];
  statusLabels: { done: string; missing: string };
  className?: string;
} & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn('divide-y divide-border rounded border border-border bg-surface', className)} {...rest}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-readiness={item.key} data-done={item.done ? 'true' : 'false'}>
          <span className="flex min-w-0 items-center gap-2.5">
            {item.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
            )}
            <span className="min-w-0 text-text">{item.label}</span>
            <span className="sr-only">{item.done ? statusLabels.done : statusLabels.missing}</span>
          </span>
          {item.action ? <span className="shrink-0 text-xs">{item.action}</span> : null}
        </li>
      ))}
    </ul>
  );
}
