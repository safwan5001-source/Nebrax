'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LayoutPanelTop, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import type { ToolCall } from '@/modules/intelligence/contract';
import { safeUiPath } from './evidence-panel';

/** ملخص مضغوط داخل اللوحة: رقم رئيسي واحد من الخادم + تنبيهات + أزرار الانتقال. التفصيل الكامل في المساحة. */
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
  const headline = result.report === 'income_statement' ? result.totals.net_income : result.totals.total;
  const headlineLabel = result.report === 'income_statement' ? t('result.net_income') : t('result.total');
  const warnings = result.report === 'income_statement' ? 0 : result.warnings.length;
  const source = result.sources[0];
  const reportHref = source ? safeUiPath(source.ui_path) : null;

  return (
    <div className="rounded border border-border bg-surface p-3" data-summary={result.report}>
      <p className="text-xs text-muted">{t(`result.${result.report}`)}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{headlineLabel}</span>
        <Money value={headline.decimal} className="text-base font-semibold" />
      </div>
      {warnings > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          {t('result.warnings')}: {warnings}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canOpenCanvas} onClick={onOpenCanvas}>
          <LayoutPanelTop className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
          {t('panel.open_canvas')}
        </Button>
        {reportHref ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={reportHref} onClick={onNavigate}>{t('panel.open_report')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
