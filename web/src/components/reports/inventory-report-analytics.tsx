'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportRankedAnalytics, type ReportRankedAnalyticsRow } from '@/components/reports/report-ranked-analytics';
import { displayLocale } from '@/lib/formatting';
import { formatRiyal } from '@/lib/money';

type InventoryAnalyticsView = 'value' | 'warehouses' | 'movements' | 'operations' | 'stocktakes';

interface InventoryAnalyticsRow {
  key: string;
  label?: string | null;
  warehouse_id?: string;
  warehouse?: string | null;
  quantity?: number;
  stock_value?: string;
  type?: string;
  number?: string;
  difference_value?: string;
}

interface InventoryAnalyticsTotals {
  in_quantity?: number;
  out_quantity?: number;
}

/**
 * تحليلات قرار مشتقة من نتائج التقرير المحملة نفسها. لا تعيد ترتيب المصدر، ولا
 * تطلب بيانات جديدة، ولا تدخل في المستندات أو تصديرها.
 */
export function InventoryReportAnalytics({
  view,
  rows,
  totals,
  loading,
}: {
  view: InventoryAnalyticsView;
  rows: InventoryAnalyticsRow[];
  totals: InventoryAnalyticsTotals;
  loading: boolean;
}) {
  const t = useTranslations('reports.inventory');
  const locale = useLocale();
  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);

  const topValueRows = useMemo<ReportRankedAnalyticsRow[]>(() => rows.map((row) => ({
    key: row.key,
    label: row.label ?? null,
    amount: row.stock_value,
  })), [rows]);

  const topWarehouseRows = useMemo<ReportRankedAnalyticsRow[]>(() => {
    const byWarehouse = new Map<string, { label: string | null; quantity: number }>();
    rows.forEach((row) => {
      const key = row.warehouse_id || row.warehouse || row.key;
      const current = byWarehouse.get(key) ?? { label: row.warehouse ?? null, quantity: 0 };
      current.quantity += row.quantity ?? 0;
      byWarehouse.set(key, current);
    });
    return [...byWarehouse.entries()].map(([key, warehouse]) => ({
      key,
      label: warehouse.label,
      rankValue: warehouse.quantity,
      displayValue: count(warehouse.quantity),
    }));
  }, [rows, count]);

  if (view === 'value') {
    return (
      <ReportRankedAnalytics
        analyticsKey="inventory-value"
        rows={topValueRows}
        loading={loading}
        title={t('analytics.value.title')}
        description={t('analytics.value.description')}
        emptyLabel={t('analytics.empty')}
        unassignedLabel={t('analytics.unassignedProduct')}
        color="var(--primary)"
        rankingMode="absolute-signed"
      />
    );
  }

  if (view === 'warehouses') {
    return (
      <ReportRankedAnalytics
        analyticsKey="inventory-warehouses"
        rows={topWarehouseRows}
        loading={loading}
        title={t('analytics.warehouses.title')}
        description={t('analytics.warehouses.description')}
        emptyLabel={t('analytics.empty')}
        unassignedLabel={t('analytics.unassignedWarehouse')}
        color="var(--primary)"
        rankingMode="absolute-signed"
      />
    );
  }

  if (view === 'movements') {
    return (
      <Card className="no-print" data-testid="inventory-movement-breakdown">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm">{t('analytics.movements.title')}</CardTitle>
          <p className="text-xs leading-5 text-muted">{t('analytics.movements.description')}</p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-border bg-background px-3 py-3">
              <dt className="text-xs text-muted">{t('incomingQuantity')}</dt>
              <dd className="num mt-1 text-lg font-semibold text-text">{count(totals.in_quantity ?? 0)}</dd>
            </div>
            <div className="rounded border border-border bg-background px-3 py-3">
              <dt className="text-xs text-muted">{t('outgoingQuantity')}</dt>
              <dd className="num mt-1 text-lg font-semibold text-text">{count(totals.out_quantity ?? 0)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    );
  }

  if (view === 'operations') {
    const operationRows = new Map<string, number>();
    rows.forEach((row) => operationRows.set(row.type ?? '', (operationRows.get(row.type ?? '') ?? 0) + 1));
    const distribution = [...operationRows.entries()].map(([type, amount]) => ({
      key: type || null,
      label: type === 'receipt' ? t('operationTypes.receipt') : type === 'issue' ? t('operationTypes.issue') : type === 'transfer' ? t('operationTypes.transfer') : null,
      rankValue: amount,
      displayValue: count(amount),
    }));

    if (distribution.length > 1) {
      return (
        <ReportRankedAnalytics
          analyticsKey="inventory-operations"
          rows={distribution}
          loading={loading}
          title={t('analytics.operations.title')}
          description={t('analytics.operations.description')}
          emptyLabel={t('analytics.empty')}
          unassignedLabel={t('analytics.unassignedOperation')}
          color="var(--primary)"
        />
      );
    }

    const only = distribution[0];
    return (
      <Card className="no-print" data-testid="inventory-operation-breakdown">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-sm">{t('analytics.operations.title')}</CardTitle>
          <p className="text-xs leading-5 text-muted">{t('analytics.operations.singleCategoryDescription')}</p>
        </CardHeader>
        <CardContent>
          {only ? (
            <dl className="rounded border border-border bg-background px-3 py-3">
              <dt className="text-xs text-muted">{only.label ?? t('analytics.unassignedOperation')}</dt>
              <dd className="num mt-1 text-lg font-semibold text-text">{only.displayValue}</dd>
            </dl>
          ) : <p className="py-8 text-center text-sm text-muted">{t('analytics.empty')}</p>}
        </CardContent>
      </Card>
    );
  }

  if (view === 'stocktakes') {
    const differenceRows = rows.map((row) => ({
      key: row.key,
      label: row.number ?? null,
      rankValue: Math.abs(Number(row.difference_value ?? 0)),
      displayValue: formatRiyal(row.difference_value ?? '0'),
    }));
    return (
      <ReportRankedAnalytics
        analyticsKey="inventory-stocktakes"
        rows={differenceRows}
        loading={loading}
        title={t('analytics.stocktakes.title')}
        description={t('analytics.stocktakes.description')}
        emptyLabel={t('analytics.empty')}
        unassignedLabel={t('analytics.unassignedStocktake')}
        color="var(--primary)"
      />
    );
  }

  return null;
}
