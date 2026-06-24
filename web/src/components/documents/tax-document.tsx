'use client';

import { useTranslations } from 'next-intl';
import { formatRiyal } from '@/lib/money';

export interface Company {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
}
export interface Party {
  name: string;
  vat_number?: string | null;
  city?: string | null;
}
export interface DocLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}

/**
 * مستند مالي A4 (RTL) عام للطباعة / حفظ PDF عبر المتصفح — يُستخدم للمشتريات
 * والمرتجعات. يُعرض داخل #print-root.print-only (مخفيّ على الشاشة).
 * العربية يرسمها المتصفح أصلاً (نص قابل للتحديد، لا صورة).
 */
export function TaxDocument({
  title,
  subtitle,
  company,
  partyLabel,
  party,
  metaRows,
  lines,
  subtotal,
  tax,
  total,
}: {
  title: string;
  subtitle?: string;
  company: Company | null;
  partyLabel: string;
  party: Party | null;
  metaRows: [string, string][];
  lines: DocLine[];
  subtotal: string;
  tax: string;
  total: string;
}) {
  const t = useTranslations('taxDoc');

  return (
    <div id="print-root" className="print-only">
      <div className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] leading-relaxed text-black">
        {/* الرأس: الشركة + عنوان المستند */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <div className="text-lg font-bold">{company?.name ?? '—'}</div>
            {company?.vat_number && (
              <div>
                {t('vat_number')}: <span className="num">{company.vat_number}</span>
              </div>
            )}
            {company?.cr_number && (
              <div>
                {t('cr_number')}: <span className="num">{company.cr_number}</span>
              </div>
            )}
          </div>
          <div className="text-end">
            <div className="text-base font-bold">{title}</div>
            {subtitle && <div className="text-[11px] text-gray-600">{subtitle}</div>}
          </div>
        </div>

        {/* الطرف + بيانات المستند */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 font-semibold">{partyLabel}</div>
            <div>{party?.name ?? '—'}</div>
            {party?.vat_number && (
              <div>
                {t('vat_number')}: <span className="num">{party.vat_number}</span>
              </div>
            )}
            {party?.city && <div>{party.city}</div>}
          </div>
          <div className="text-end">
            {metaRows.map(([label, value]) => (
              <div key={label}>
                {label}: <span className="num">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* السطور */}
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 p-1.5 text-start">{t('description')}</th>
              <th className="border border-gray-400 p-1.5 text-end">{t('qty')}</th>
              <th className="border border-gray-400 p-1.5 text-end">{t('unit_price')}</th>
              <th className="border border-gray-400 p-1.5 text-end">{t('tax')}</th>
              <th className="border border-gray-400 p-1.5 text-end">{t('total')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="border border-gray-400 p-1.5">{l.description ?? '—'}</td>
                <td className="num border border-gray-400 p-1.5 text-end">{l.quantity}</td>
                <td className="num border border-gray-400 p-1.5 text-end">{formatRiyal(l.unit_price)}</td>
                <td className="num border border-gray-400 p-1.5 text-end">{formatRiyal(l.line_tax)}</td>
                <td className="num border border-gray-400 p-1.5 text-end">{formatRiyal(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* الإجماليات */}
        <div className="mt-4 flex justify-end">
          <div className="w-1/2 max-w-[260px] space-y-1">
            <div className="flex justify-between">
              <span>{t('subtotal')}</span>
              <span className="num">{formatRiyal(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('vat')}</span>
              <span className="num">{formatRiyal(tax)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-black pt-1 font-bold">
              <span>{t('grand_total')}</span>
              <span className="num">{formatRiyal(total)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-gray-300 pt-2 text-center text-[10px] text-gray-500">
          {t('footer')}
        </div>
      </div>
    </div>
  );
}
