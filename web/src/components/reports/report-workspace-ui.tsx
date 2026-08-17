'use client';

/**
 * أسلوب «دفتر التحليل»: النطاق والنتيجة قبل الجدول، والجوال يعرض صفوفاً قابلة
 * للمس بدلاً من ضغط جدول سطح المكتب. الأزرق الأساسي للفعل فقط؛ الدلالات المالية
 * تتطلب نصاً واضحاً إلى جانب اللون.
 */

import { useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ReportAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export interface ReportMetric {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'warning';
}

export interface ReportColumnCell {
  label: string;
  align?: 'start' | 'end';
}

export function ReportScreenHeader({
  title,
  description,
  scope,
  actions,
  actionsLabel,
}: {
  title: string;
  description?: string;
  scope?: string;
  actions?: ReportAction[];
  actionsLabel?: string;
}) {
  return (
    <header className="no-print flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-text sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p>}
        {scope && (
          <p className="mt-3 inline-flex max-w-full items-center rounded-full border border-primary/15 bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <span className="truncate">{scope}</span>
          </p>
        )}
      </div>
      {actions && actionsLabel && <ReportActionMenu actions={actions} actionsLabel={actionsLabel} />}
    </header>
  );
}

export function ReportActionMenu({ actions, actionsLabel }: { actions: ReportAction[]; actionsLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="hidden flex-wrap justify-end gap-2 sm:flex">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button key={action.id} variant="outline" size="sm" disabled={action.disabled || action.busy} onClick={action.onSelect}>
              <Icon className="h-4 w-4" strokeWidth={1.7} />
              {action.label}
            </Button>
          );
        })}
      </div>

      <div className="sm:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
          {actionsLabel}
        </Button>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title={actionsLabel} className="sm:max-w-sm">
        <div className="grid gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.id}
                variant="outline"
                className="h-11 justify-start"
                disabled={action.disabled || action.busy}
                onClick={() => {
                  action.onSelect();
                  setOpen(false);
                }}
              >
                <Icon className="h-4 w-4" strokeWidth={1.7} />
                {action.label}
              </Button>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}

export function ReportMetricGrid({ metrics }: { metrics: ReportMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <section aria-label="report-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={`${metric.label}-${index}`}
          className={cn(
            'rounded border border-border bg-surface p-4',
            index === 0 && 'sm:col-span-2 xl:col-span-1'
          )}
        >
          <p className="text-xs font-medium text-muted">{metric.label}</p>
          <p
            className={cn(
              'num mt-2 text-lg font-semibold tracking-[-0.02em] text-text',
              metric.tone === 'positive' && 'text-positive',
              metric.tone === 'negative' && 'text-negative',
              metric.tone === 'warning' && 'text-warning'
            )}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </section>
  );
}

export function ReportMobileRows({
  columns,
  rows,
  totalRow,
  emptyText,
  primaryIndex = 0,
  secondaryIndex,
}: {
  columns: ReportColumnCell[];
  rows: string[][];
  totalRow?: string[] | null;
  emptyText?: string;
  primaryIndex?: number;
  secondaryIndex?: number;
}) {
  const valueIndexes = columns.map((_, index) => index).filter((index) => index !== primaryIndex && index !== secondaryIndex);

  const rowView = (row: string[], key: string, total = false) => (
    <article key={key} className={cn('rounded border border-border bg-surface p-3.5', total && 'border-primary/25 bg-primary-soft')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{row[primaryIndex] || '—'}</p>
          {secondaryIndex !== undefined && row[secondaryIndex] && <p className="num mt-1 text-xs text-muted">{row[secondaryIndex]}</p>}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {valueIndexes.map((index) => (
          <div key={`${key}-${columns[index]?.label}`} className={cn(index === valueIndexes.length - 1 && valueIndexes.length % 2 === 1 && 'col-span-2')}>
            <dt className="text-[11px] font-medium text-muted">{columns[index]?.label}</dt>
            <dd className="num mt-1 text-sm font-medium text-text">{row[index] || '—'}</dd>
          </div>
        ))}
      </dl>
    </article>
  );

  return (
    <div className="space-y-2 md:hidden">
      {rows.length === 0 && emptyText ? <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{emptyText}</p> : rows.map((row, index) => rowView(row, `${row[primaryIndex]}-${index}`))}
      {totalRow && rowView(totalRow, 'report-total', true)}
    </div>
  );
}
