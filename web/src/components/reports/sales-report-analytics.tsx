'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RankedBars } from '@/components/charts/area-line';
import { formatRiyal } from '@/lib/money';

export type SalesAnalyticsView = 'customer' | 'product' | 'salesperson';

export interface SalesAnalyticsRow {
  key: string | null;
  label: string | null;
  amount?: string;
}

/**
 * تحليل تصنيفي واحد متعمد: صفوف report.data نفسها هي مصدر الرسم والجدول، لذلك لا
 * يوجد طلب إضافي ولا احتمال أن يختلف الرسم عن نطاق المرشحات أو إجماليات الملخص.
 */
export function SalesReportAnalytics({
  view,
  rows,
  loading,
  title,
  description,
  emptyLabel,
  unassignedLabel,
}: {
  view: SalesAnalyticsView;
  rows: SalesAnalyticsRow[];
  loading: boolean;
  title: string;
  description: string;
  emptyLabel: string;
  unassignedLabel: string;
}) {
  const rankedRows = rows
    .map((row) => ({ label: row.label || unassignedLabel, amount: Number(row.amount ?? 0) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .slice(0, 6);

  return (
    <Card className="no-print" data-testid={`sales-analytics-${view}`}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs leading-5 text-muted">{description}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : rankedRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>
        ) : (
          <RankedBars rows={rankedRows} format={(amount) => formatRiyal(String(amount))} emptyLabel={emptyLabel} />
        )}
      </CardContent>
    </Card>
  );
}
