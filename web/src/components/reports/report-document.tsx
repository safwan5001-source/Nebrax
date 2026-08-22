'use client';

import { useTranslations } from 'next-intl';
import {
  buildTabularReportDocument,
  type SourceTabularReportColumn,
} from '@/modules/document-families/tabular-report/from-legacy-report';
import type { TabularReportCell } from '@/modules/document-families/types';

export interface Company {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
}

export type ReportColumn = SourceTabularReportColumn;

function displayCell(cell: TabularReportCell | undefined): string {
  if (!cell) return '';
  if (cell.kind === 'document_link') return cell.label;
  return String(cell.value);
}

/**
 * مستند تقرير مالي A4 (RTL) للطباعة / حفظ PDF عبر المتصفح.
 * يبني أولاً عقد تقرير جدولي منظماً؛ لا يحسب مبالغاً أو يعيد جمع صفوف المصدر.
 */
export function ReportDocument({
  title,
  asOf,
  company,
  columns,
  rows,
  totalRow,
}: {
  title: string;
  asOf?: string | null;
  company: Company | null;
  columns: ReportColumn[];
  rows: string[][];
  totalRow?: string[] | null;
}) {
  const t = useTranslations('reportDoc');
  const document = buildTabularReportDocument({
    reportKey: 'legacy_tabular_report',
    title,
    asOf,
    company,
    columns,
    rows,
    totalRow,
    generatedAt: new Date().toISOString(),
  });
  const group = document.groups[0];

  return (
    <div id="print-root" className="print-only">
      <div className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] leading-relaxed text-black">
        <div className="border-b-2 border-black pb-3 text-center">
          <div className="text-lg font-bold">{document.organization.name}</div>
          {document.organization.vatNumber && (
            <div className="text-[11px]">
              {t('vat_number')}: <span className="num">{document.organization.vatNumber}</span>
            </div>
          )}
          <div className="mt-2 text-base font-bold">{document.title}</div>
          {document.scope.asOf && (
            <div className="text-[11px] text-gray-600">
              {t('as_of')}: <span className="num">{document.scope.asOf}</span>
            </div>
          )}
        </div>

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              {document.columns.map((column) => (
                <th
                  key={column.id}
                  className={`border border-gray-400 p-1.5 ${column.alignment === 'end' ? 'text-end' : 'text-start'}`}
                >
                  {column.labelKey}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.id}>
                {document.columns.map((column) => (
                  <td
                    key={column.id}
                    className={`border border-gray-400 p-1.5 ${column.alignment === 'end' ? 'num text-end' : ''}`}
                  >
                    {displayCell(row.cells[column.id])}
                  </td>
                ))}
              </tr>
            ))}
            {document.grandTotal && (
              <tr className="bg-gray-50 font-bold">
                {document.columns.map((column) => (
                  <td
                    key={column.id}
                    className={`border border-gray-400 p-1.5 ${column.alignment === 'end' ? 'num text-end' : ''}`}
                  >
                    {displayCell(document.grandTotal?.[column.id])}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-6 border-t border-gray-300 pt-2 text-center text-[10px] text-gray-500">
          {t('footer')}
        </div>
      </div>
    </div>
  );
}
