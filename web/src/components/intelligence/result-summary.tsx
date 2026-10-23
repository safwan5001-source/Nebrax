'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LayoutPanelTop, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { cn } from '@/lib/utils';
import type { ToolCall } from '@/modules/intelligence/contract';
import { safeUiPath } from './evidence-panel';
import { toneOf } from './kpi-tile';

const TONE = { neutral: 'text-text', positive: 'text-positive', negative: 'text-negative' } as const;

/**
 * ملخص مضغوط داخل اللوحة: الرقم الرئيسي أولاً ثم رقمان ثانويان من الخادم، فالتنبيهات والانتقال.
 * لا حساب هنا: كل قيمة مرسلة من الخدمة. التفصيل الكامل في المساحة.
 */
export function ResultSummary({
  call,
  canOpenCanvas,
  onOpenCanvas,
  onNavigate,
}: {
  call: ToolCall;
  canOpenCanvas: boolean;
  onOpenCanvas: () => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('intelligence');
  const { result } = call;
  const income = result.report === 'income_statement';
  const headline = income ? result.totals.net_income : result.totals.total;
  const tone = income ? toneOf(result.totals.net_income.minor) : 'neutral';
  const secondary = income
    ? [
        { label: t('result.total_revenue'), value: result.totals.total_revenue.decimal },
        { label: t('result.total_expense'), value: result.totals.total_expense.decimal },
      ]
    : [{ label: `${t('result.buckets.b90_plus')} ${t('result.days')}`, value: result.totals.b90_plus.decimal }];
  const warnings = income ? 0 : result.warnings.length;
  const source = result.sources[0];
  const reportHref = source ? safeUiPath(source.ui_path) : null;

  return (
    <div className="awj-intel-rise rounded border border-border bg-surface p-3" data-summary={result.report}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{t(`result.${result.report}`)}</p>
        <Badge tone="muted">
          <span dir="ltr" className="num">{income ? `${result.period.from} → ${result.period.to}` : result.as_of}</span>
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{income ? t('result.net_income') : t('result.total')}</p>
      <Money value={headline.decimal} className={cn('block text-xl font-semibold', TONE[tone])} />
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
        {secondary.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="truncate text-muted">{item.label}</dt>
            <dd className="mt-0.5"><Money value={item.value} className="text-sm" /></dd>
          </div>
        ))}
      </dl>
      {warnings > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          {t('result.warnings')}: {warnings}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={!canOpenCanvas} onClick={onOpenCanvas}>
          <LayoutPanelTop className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
          {t('panel.open_canvas')}
        </Button>
        {reportHref ? (
          <Button asChild size="sm" variant="ghost" className="h-9">
            <Link href={reportHref} onClick={onNavigate}>{t('panel.open_report')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
