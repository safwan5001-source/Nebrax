'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RankedBars } from '@/components/charts/area-line';
import { formatRiyal } from '@/lib/money';

export interface ReportRankedAnalyticsRow {
  key: string | null;
  label: string | null;
  amount?: string;
}

/**
 * تحليل تصنيفي خفيف مشتق من صفوف الملخص نفسها. لا يطلب بيانات إضافية ولا يغيّر
 * ترتيب المصدر: ranking يعمل على نسخة من الصفوف المعروضة للرسم فقط.
 */
export function ReportRankedAnalytics({
  analyticsKey,
  rows,
  loading,
  title,
  description,
  emptyLabel,
  unassignedLabel,
  testId,
}: {
  analyticsKey: string;
  rows: ReportRankedAnalyticsRow[];
  loading: boolean;
  title: string;
  description: string;
  emptyLabel: string;
  unassignedLabel: string;
  testId?: string;
}) {
  const rankedRows = rows
    .map((row) => ({ label: row.label || unassignedLabel, amount: Number(row.amount ?? 0) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);

  return (
    <Card className="no-print" data-testid={testId ?? `report-ranked-analytics-${analyticsKey}`}>
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
