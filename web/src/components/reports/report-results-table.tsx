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
}

export function ReportResultsTable({
  columns,
  rows,
  totalRow,
  emptyText,
  primaryIndex = 0,
  secondaryIndex,
}: ReportResultsTableProps) {
  const locale = useLocale();
  const dataColumns: ReportDataColumn[] = columns.map((column, index) => ({
    id: `column-${index}`,
    label: column.label,
    align: column.align,
    numeric: column.align === 'end',
    hideable: index !== primaryIndex,
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
        />
      </div>
      <div className="hidden md:block">
        <ReportDataTable
          columns={dataColumns}
          rows={rows}
          totalRow={totalRow}
          labels={defaultReportTableLabels(locale)}
          emptyText={emptyText}
        />
      </div>
    </>
  );
}
