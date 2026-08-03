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
 * مستند فاتورة ضريبية A4 (RTL) — تصميم احترافي.
 * يُعرَض داخل #print-root.print-only: مخفيّ على الشاشة، يظهر عند الطباعة،
 * ويُلتقَط أيضاً لتوليد PDF (lib/pdf.ts). العربية يرسمها المتصفح.
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
  const brand = '#1e40af';

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
      <div className="flex justify-between gap-3 py-0.5">
        <span className="text-gray-500">{label}</span>
        <span className="font-medium text-black">{value}</span>
      </div>
    ) : null;

  return (
    <div id="print-root" className="print-only">
      <div className="mx-auto flex min-h-[277mm] max-w-[210mm] flex-col bg-white p-8 text-[12px] leading-relaxed text-black">
        {/* ═══ الترويسة ═══ */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white"
              style={{ background: brand }}
            >
              نـ
            </div>
            <div>
              <div className="text-lg font-bold text-black">{company?.name ?? '—'}</div>
              <div className="text-[11px] text-gray-500">{t('brand_tagline')}</div>
            </div>
          </div>
          <div className="text-end">
            <div className="text-xl font-bold" style={{ color: brand }}>
              {t('title')}
            </div>
            <div className="text-[11px] text-gray-500">{t('title_en')}</div>
            <div className="mt-2 inline-block rounded-md bg-gray-100 px-3 py-1">
              <span className="text-gray-500">{t('number')}: </span>
              <span className="num font-bold text-black">{invoice.number}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 h-1 rounded" style={{ background: brand }} />

        {/* ═══ البائع / المشتري / بيانات المستند ═══ */}
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('seller')}</div>
            <div className="font-semibold text-black">{company?.name ?? '—'}</div>
            <InfoRow label={t('vat_number')} value={company?.vat_number ? <span className="num">{company.vat_number}</span> : null} />
            <InfoRow label={t('cr_number')} value={company?.cr_number ? <span className="num">{company.cr_number}</span> : null} />
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('bill_to')}</div>
            <div className="font-semibold text-black">{customer?.name ?? '—'}</div>
            <InfoRow label={t('vat_number')} value={customer?.vat_number ? <span className="num">{customer.vat_number}</span> : null} />
            <InfoRow label={t('city')} value={customer?.city} />
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('meta')}</div>
            <InfoRow label={t('date')} value={<span className="num">{invoice.invoice_date}</span>} />
            <InfoRow label={t('payment_type')} value={invoice.payment_type === 'cash' ? t('cash') : t('credit')} />
          </div>
        </div>

        {/* ═══ السطور ═══ */}
        <table className="mt-5 w-full border-collapse text-[11px]">
          <thead>
            <tr style={{ background: brand, color: '#fff' }}>
              <th className="p-2 text-start font-semibold">#</th>
              <th className="p-2 text-start font-semibold">{t('description')}</th>
              <th className="p-2 text-end font-semibold">{t('qty')}</th>
              <th className="p-2 text-end font-semibold">{t('unit_price')}</th>
              <th className="p-2 text-end font-semibold">{t('tax')}</th>
              <th className="p-2 text-end font-semibold">{t('total')}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={l.id} className={i % 2 ? 'bg-gray-50' : ''}>
                <td className="num border-b border-gray-200 p-2 text-gray-500">{i + 1}</td>
                <td className="border-b border-gray-200 p-2">{l.description ?? '—'}</td>
                <td className="num border-b border-gray-200 p-2 text-end">{l.quantity}</td>
                <td className="num border-b border-gray-200 p-2 text-end">{formatRiyal(l.unit_price)}</td>
                <td className="num border-b border-gray-200 p-2 text-end">{formatRiyal(l.line_tax)}</td>
                <td className="num border-b border-gray-200 p-2 text-end font-medium">{formatRiyal(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ═══ QR + الإجماليات ═══ */}
        <div className="mt-5 flex items-start justify-between gap-6">
          <div className="flex flex-col items-center gap-1">
            {qr ? (
              <>
                <div className="rounded-lg border border-gray-200 p-2">
                  <QRCodeSVG value={qr} size={110} level="M" />
                </div>
                <div className="text-[9px] text-gray-400">{t('zatca_note')}</div>
              </>
            ) : (
              <div />
            )}
          </div>
          <div className="w-[46%] max-w-[280px] overflow-hidden rounded-lg border border-gray-200">
            <div className="flex justify-between px-3 py-1.5 text-gray-600">
              <span>{t('subtotal')}</span>
              <span className="num">{formatRiyal(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 px-3 py-1.5 text-gray-600">
              <span>{t('vat')}</span>
              <span className="num">{formatRiyal(invoice.tax_amount)}</span>
            </div>
            <div
              className="flex items-baseline justify-between px-3 py-2.5 font-bold text-white"
              style={{ background: brand }}
            >
              <span>{t('grand_total')}</span>
              <span className="num text-base">{formatRiyal(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* ═══ التذييل ═══ */}
        <div className="mt-auto pt-6">
          <div className="rounded-lg bg-gray-50 p-3 text-center text-[10px] text-gray-500">{t('footer')}</div>
        </div>
      </div>
    </div>
  );
}
