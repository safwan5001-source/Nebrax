'use client';

import {
  ReportRankedAnalytics,
  type ReportRankedAnalyticsRow,
} from '@/components/reports/report-ranked-analytics';

export type SalesAnalyticsView = 'customer' | 'product' | 'salesperson';
export type SalesAnalyticsRow = ReportRankedAnalyticsRow;

/** توافق Phase 4A: يبقى عقد المبيعات ثابتاً بينما يستخدم ranked renderer المشترك. */
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
  return (
    <ReportRankedAnalytics
      analyticsKey={view}
      rows={rows}
      loading={loading}
      title={title}
      description={description}
      emptyLabel={emptyLabel}
      unassignedLabel={unassignedLabel}
      testId={`sales-analytics-${view}`}
    />
  );
}
