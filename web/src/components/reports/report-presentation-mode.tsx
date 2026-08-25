'use client';

import { cn } from '@/lib/utils';

export type ReportPresentationMode = 'summary' | 'detail';

/**
 * وضع عرض محلي للتقرير. لا يدخل عمداً في Saved Views لأن تلك تحفظ presentation state
 * الخاص بـDataTable فقط، ولا يغيّر semantics التصدير أو الفلاتر.
 */
export function ReportPresentationModeControl({
  value,
  onChange,
  summaryLabel,
  detailLabel,
  label,
}: {
  value: ReportPresentationMode;
  onChange: (mode: ReportPresentationMode) => void;
  summaryLabel: string;
  detailLabel: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="no-print inline-flex rounded border border-border bg-background p-0.5" data-testid="report-presentation-mode">
      {([
        ['summary', summaryLabel],
        ['detail', detailLabel],
      ] as const).map(([mode, modeLabel]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'min-h-8 rounded px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            value === mode ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text',
          )}
        >
          {modeLabel}
        </button>
      ))}
    </div>
  );
}
