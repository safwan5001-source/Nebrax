'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AreaLine } from '@/components/charts/area-line';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportRankedAnalytics, type ReportRankedAnalyticsRow } from '@/components/reports/report-ranked-analytics';
import { displayLocale } from '@/lib/formatting';

type CustomerAnalyticsView = 'sales' | 'balances' | 'payments' | 'appointments';

interface CustomerAnalyticsRow {
  key: string | null;
  label: string | null;
  amount?: string;
  balance?: string;
  appointments?: number;
}

/**
 * تحليلات عرضية مشتقة من الصفوف المحمّلة للتقرير فقط. لا تعرف المسارات، ولا
 * تطلب بيانات إضافية، وتحافظ على ترتيب buckets الزمني في تقرير المدفوعات.
 */
export function CustomerReportAnalytics({
  view,
  rows,
  loading,
}: {
  view: CustomerAnalyticsView;
  rows: CustomerAnalyticsRow[];
  loading: boolean;
}) {
  const t = useTranslations('reports.customers');
  const locale = useLocale();
  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);

  const salesRows = useMemo<ReportRankedAnalyticsRow[]>(() => rows.map((row) => ({
    key: row.key,
    label: row.label,
    amount: row.amount,
  })), [rows]);

  const balanceRows = useMemo<ReportRankedAnalyticsRow[]>(() => rows.map((row) => ({
    key: row.key,
    label: row.label,
    amount: row.balance,
  })), [rows]);

  const appointmentRows = useMemo<ReportRankedAnalyticsRow[]>(() => rows.map((row) => ({
    key: row.key,
    label: row.label,
    rankValue: row.appointments ?? 0,
    displayValue: count(row.appointments ?? 0),
  })), [rows, count]);

  if (view === 'sales') {
    return (
      <ReportRankedAnalytics
        analyticsKey="customer-sales"
        rows={salesRows}
        loading={loading}
        title={t('analytics.sales.title')}
        description={t('analytics.sales.description')}
        emptyLabel={t('analytics.empty')}
        unassignedLabel={t('analytics.unassignedCustomer')}
        color="var(--primary)"
      />
    );
  }

  if (view === 'balances') {
    return (
      <ReportRankedAnalytics
        analyticsKey="customer-balances"
        rows={balanceRows}
        loading={loading}
        title={t('analytics.balances.title')}
        description={t('analytics.balances.description')}
        emptyLabel={t('analytics.empty')}
        unassignedLabel={t('analytics.unassignedCustomer')}
        color="var(--primary)"
      />
    );
  }

  if (view === 'payments') {
    const amounts = rows.map((row) => Number(row.amount ?? 0)).filter(Number.isFinite);
    return (
      <Card className="no-print" data-testid="customer-payments-trend">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm">{t('analytics.payments.title')}</CardTitle>
          <p className="text-xs leading-5 text-muted">{t('analytics.payments.description')}</p>
        </CardHeader>
        <CardContent>
          {loading ? <div className="h-40 animate-pulse rounded bg-border/60" />
            : amounts.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('analytics.empty')}</p>
              : <AreaLine data={amounts} color="var(--primary)" label={t('analytics.payments.chartLabel')} className="w-full" />}
        </CardContent>
      </Card>
    );
  }

  return (
    <ReportRankedAnalytics
      analyticsKey="customer-appointments"
      rows={appointmentRows}
      loading={loading}
      title={t('analytics.appointments.title')}
      description={t('analytics.appointments.description')}
      emptyLabel={t('analytics.empty')}
      unassignedLabel={t('analytics.unassignedCustomer')}
      color="var(--primary)"
    />
  );
}
