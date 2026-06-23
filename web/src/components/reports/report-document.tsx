'use client';

import { useTranslations } from 'next-intl';

export interface Company {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
}
export interface ReportColumn {
  label: string;
  align?: 'start' | 'end';
}

/**
 * مستند تقرير مالي A4 (RTL) للطباعة / حفظ PDF عبر المتصفح.
 * يُعرض داخل #print-root.print-only — مخفيّ على الشاشة، يظهر عند الطباعة فقط.
 * عام: يستقبل عنوان التقرير، الأعمدة، الصفوف، وصف اختياري لصف الإجمالي.
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

  return (
    <div id="print-root" className="print-only">
      <div className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] leading-relaxed text-black">
        {/* الرأس: الشركة + عنوان التقرير */}
        <div className="border-b-2 border-black pb-3 text-center">
          <div className="text-lg font-bold">{company?.name ?? '—'}</div>
          {company?.vat_number && (
            <div className="text-[11px]">
              {t('vat_number')}: <span className="num">{company.vat_number}</span>
            </div>
          )}
          <div className="mt-2 text-base font-bold">{title}</div>
          {asOf && (
            <div className="text-[11px] text-gray-600">
              {t('as_of')}: <span className="num">{asOf}</span>
            </div>
          )}
        </div>

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`border border-gray-400 p-1.5 ${c.align === 'end' ? 'text-end' : 'text-start'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`border border-gray-400 p-1.5 ${columns[ci]?.align === 'end' ? 'num text-end' : ''}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {totalRow && (
              <tr className="bg-gray-50 font-bold">
                {totalRow.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`border border-gray-400 p-1.5 ${columns[ci]?.align === 'end' ? 'num text-end' : ''}`}
                  >
                    {cell}
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
