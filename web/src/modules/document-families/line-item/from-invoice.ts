import { riyalToMinor } from '@/lib/money';
import type { SourceCompany, SourceCustomer, SourceInvoice } from '@/modules/documents/builder/from-invoice';
import type { LineItemDocument } from '../types';

function buildNationalAddress(company: SourceCompany | null): string | null {
  if (!company) return null;

  const parts = [
    company.building_no?.trim(),
    company.street?.trim(),
    company.additional_no?.trim(),
    company.district?.trim(),
    company.city?.trim(),
    company.postal_code?.trim(),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join('، ') : (company.short_address?.trim() || null);
}

/**
 * يبني عقد فاتورة عائلة البنود من مصدر API. كل التحويلات إلى الوحدات الصغرى
 * متوافقة مع العارض القائم؛ لا يعيد هذا الباني حساب إجماليات المصدر.
 */
export function buildInvoiceLineItemDocument(input: {
  invoice: SourceInvoice;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
  qr: string | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): LineItemDocument {
  const { invoice, company, customer, qr, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;

  return {
    family: 'line_item',
    type: 'tax_invoice',
    currency: 'SAR',
    direction: 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      address: buildNationalAddress(company),
      phone: company?.phone?.trim() || null,
      mobile: company?.mobile?.trim() || null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : (company?.logo ?? null),
      logoHeight: logoHeight ?? null,
    },
    counterparty: {
      name: customer?.name ?? '—',
      vatNumber: customer?.vat_number ?? null,
      city: customer?.city ?? null,
    },
    meta: {
      number: invoice.number,
      date: invoice.invoice_date,
      paymentType: invoice.payment_type === 'cash' ? 'cash' : 'credit',
    },
    content: {
      footerText: footerText && footerText.trim() !== '' ? footerText : null,
      notes: invoice.notes ?? null,
      terms: terms && terms.trim() !== '' ? terms : null,
      bank: bank && bank.trim() !== '' ? bank : null,
      stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
      signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
    },
    lines: invoice.lines.map((line) => ({
      id: line.id,
      productName: line.product_name ?? line.description ?? null,
      productCode: line.product_code ?? null,
      barcode: line.barcode ?? null,
      description: line.description ?? '',
      quantity: line.quantity,
      unitPrice: riyalToMinor(line.unit_price),
      priceBeforeTax: line.unit_price_before_tax === null || line.unit_price_before_tax === undefined
        ? null
        : riyalToMinor(line.unit_price_before_tax),
      tax: riyalToMinor(line.line_tax),
      total: riyalToMinor(line.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(invoice.subtotal),
      tax: riyalToMinor(invoice.tax_amount),
      total: riyalToMinor(invoice.total),
    },
    compliance: {
      qr: qr ? { value: qr } : null,
    },
  };
}
