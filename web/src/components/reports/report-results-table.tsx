'use client';

import { useLocale } from 'next-intl';
import { ReportMobileRows, type ReportColumnCell } from '@/components/reports/report-workspace-ui';
import {
  ReportDataTable,
  defaultReportTableLabels,
  type ReportDataColumn,
} from '@/components/reports/report-data-table';

export interface ReportResultsTableProps {
  columns: ReportColumnCell[];
  rows: string[][];
  totalRow?: string[] | null;
  emptyText?: string;
  primaryIndex?: number;
  secondaryIndex?: number;
  rowHrefs?: Array<string | null | undefined>;
}

export function ReportResultsTable({
  columns,
  rows,
  totalRow,
  emptyText,
  primaryIndex = 0,
  secondaryIndex,
  rowHrefs,
}: ReportResultsTableProps) {
  const locale = useLocale();
  const labels = defaultReportTableLabels(locale);
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
        />
      </div>
    </>
  );
}
