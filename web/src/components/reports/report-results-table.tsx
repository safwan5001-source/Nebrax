'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { ReportMobileRows, type ReportColumnCell } from '@/components/reports/report-workspace-ui';
import {
  ReportDataTable,
  defaultReportTableLabels,
  type ReportDataColumn,
  type ReportTableViewState,
} from '@/components/reports/report-data-table';
import { ReportSavedViewsMenu, useSavedReportViews } from '@/components/reports/report-saved-views';

export interface ReportResultsTableProps {
  columns: ReportColumnCell[];
  rows: string[][];
  totalRow?: string[] | null;
  emptyText?: string;
  primaryIndex?: number;
  secondaryIndex?: number;
  rowHrefs?: Array<string | null | undefined>;
  reportKey?: string;
}

export function ReportResultsTable({
  columns,
  rows,
  totalRow,
  emptyText,
  primaryIndex = 0,
  secondaryIndex,
  rowHrefs,
  reportKey,
}: ReportResultsTableProps) {
  const locale = useLocale();
  const labels = defaultReportTableLabels(locale);
  const defaultViewState = useMemo<ReportTableViewState>(() => ({ columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25 }), []);
  const savedViews = useSavedReportViews(reportKey, defaultViewState);
  const rowActions = rowHrefs?.map((href) => href ? { href, label: labels.openDetails } : null);
  const dataColumns: ReportDataColumn[] = columns.map((column, index) => ({
    id: `column-${index}`,
    label: column.label,
    align: column.align,
    numeric: column.align === 'end',
    hideable: index !== primaryIndex,
    cellTone: column.cellTone,
  }));

  return (
    <>
      {reportKey && savedViews.loaded && <div className="no-print mb-3 flex justify-end md:hidden"><ReportSavedViewsMenu controller={savedViews} locale={locale} /></div>}
      <div className="md:hidden">
        <ReportMobileRows
          columns={columns}
          rows={rows}
          totalRow={totalRow}
          emptyText={emptyText}
          primaryIndex={primaryIndex}
          secondaryIndex={secondaryIndex}
          rowActions={rowActions}
        />
      </div>
      <div className="hidden md:block">
        <ReportDataTable
          columns={dataColumns}
          rows={rows}
          totalRow={totalRow}
          labels={labels}
          emptyText={emptyText}
          primaryColumnId={`column-${primaryIndex}`}
          rowActions={rowActions}
          viewState={reportKey ? savedViews.viewState : undefined}
          onViewStateChange={reportKey ? savedViews.setViewState : undefined}
          toolbarAddon={reportKey && savedViews.loaded ? <ReportSavedViewsMenu controller={savedViews} locale={locale} /> : undefined}
        />
      </div>
    </>
  );
}
