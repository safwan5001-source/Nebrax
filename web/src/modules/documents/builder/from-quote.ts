import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';
import { buildDocumentSeller } from './company-seller';

/** أشكال مصدر عرض السعر (عقد الـ API) — المبالغ بالريال نصّاً. */
export interface SourceQuoteLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}
export interface SourceQuote {
  number: string;
  quote_date: string;
  valid_until: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes?: string | null;
  lines: SourceQuoteLine[];
}

/**
 * يبني `DocumentModel` من عرض سعر (النوع `quotation`). بلا QR ضريبي (عرض السعر
 * ليس مستنداً ضريبياً)، ويعيد استخدام نفس الأقسام والقوالب.
 */
export function buildQuoteDocumentModel(input: {
  quote: SourceQuote;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  const { quote, company, customer, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;
  const seller = buildDocumentSeller(company, { logoUrl, logoHeight });

  return {
    type: 'quotation',
    currency: 'SAR',
    direction: 'rtl',
    seller,
    buyer: {
      name: customer?.name ?? '—',
      vatNumber: customer?.vat_number ?? null,
      city: customer?.city ?? null,
    },
    meta: {
      number: quote.number,
      date: quote.quote_date,
      dueDate: quote.valid_until,
      paymentType: null,
    },
    lines: quote.lines.map((l) => ({
      id: l.id,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPrice: riyalToMinor(l.unit_price),
      tax: riyalToMinor(l.line_tax),
      total: riyalToMinor(l.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(quote.subtotal),
      tax: riyalToMinor(quote.tax_amount),
      total: riyalToMinor(quote.total),
    },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: quote.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
