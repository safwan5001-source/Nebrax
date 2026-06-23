'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { formatRiyal } from '@/lib/money';

interface Line {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: number;
  line_tax: string;
  line_total: string;
}
export interface InvoiceDoc {
  number: string;
  invoice_date: string;
  payment_type: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  lines: Line[];
}
export interface Company {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
}
export interface Customer {
  name: string;
  vat_number?: string | null;
  city?: string | null;
}

/**
 * مستند فاتورة ضريبية A4 (RTL) للطباعة / حفظ PDF عبر المتصفح.
 * يُعرض داخل #print-root.print-only — مخفيّ على الشاشة، يظهر عند الطباعة فقط.
 * العربية يرسمها المتصفح أصلاً (نص قابل للتحديد، لا صورة).
 */
export function InvoiceDocument({
  invoice,
  company,
  customer,
  qr,
}: {
  invoice: InvoiceDoc;
  company: Company | null;
  customer: Customer | null;
  qr: string | null;
}) {
  const t = useTranslations('invoiceDoc');

  return (
    <div id="print-root" className="print-only">
      <div className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] leading-relaxed text-black">
        {/* الرأس: البائع + عنوان المستند */}
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
            <div className="text-base font-bold">{t('title')}</div>
            <div className="text-[11px] text-gray-600">{t('title_en')}</div>
          </div>
        </div>

        {/* بيانات الفاتورة + العميل */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 font-semibold">{t('bill_to')}</div>
            <div>{customer?.name ?? '—'}</div>
            {customer?.vat_number && (
              <div>
                {t('vat_number')}: <span className="num">{customer.vat_number}</span>
              </div>
            )}
            {customer?.city && <div>{customer.city}</div>}
          </div>
          <div className="text-end">
            <div>
              {t('number')}: <span className="num font-semibold">{invoice.number}</span>
            </div>
            <div>
              {t('date')}: <span className="num">{invoice.invoice_date}</span>
            </div>
            <div>
              {t('payment_type')}: {invoice.payment_type === 'cash' ? t('cash') : t('credit')}
            </div>
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
            {invoice.lines.map((l) => (
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

        {/* الإجماليات + رمز ZATCA */}
        <div className="mt-4 flex items-start justify-between gap-4">
          {qr ? (
            <div className="rounded border border-gray-300 p-2">
              <QRCodeSVG value={qr} size={104} level="M" />
            </div>
          ) : (
            <div />
          )}
          <div className="w-1/2 max-w-[260px] space-y-1">
            <div className="flex justify-between">
              <span>{t('subtotal')}</span>
              <span className="num">{formatRiyal(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('vat')}</span>
              <span className="num">{formatRiyal(invoice.tax_amount)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-black pt-1 font-bold">
              <span>{t('grand_total')}</span>
              <span className="num">{formatRiyal(invoice.total)}</span>
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
