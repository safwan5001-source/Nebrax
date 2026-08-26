import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';
import { buildDocumentSeller } from './company-seller';

/** أشكال مصدر الإشعار الدائن (عقد الـ API) — المبالغ بالريال نصّاً. */
export interface SourceCreditNoteLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}
export interface SourceCreditNote {
  number: string;
  note_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  reason?: string | null;
  /** إشعار مبيعات دائن أو إشعار مشتريات مدين؛ يحدد دلالة الطرف في القالب. */
  type?: 'sales' | 'purchase';
  lines: SourceCreditNoteLine[];
}

/** يبني `DocumentModel` من إشعار دائن/مدين — يعيد استخدام نفس القوالب. */
export function buildCreditNoteDocumentModel(input: {
  note: SourceCreditNote;
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
  const { note, company, customer, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;
  const seller = buildDocumentSeller(company, { logoUrl, logoHeight });

  return {
    type: note.type === 'purchase' ? 'debit_note' : 'credit_note',
    currency: 'SAR',
    direction: 'rtl',
    seller,
    buyer: {
      name: customer?.name ?? '—',
      vatNumber: customer?.vat_number ?? null,
      city: customer?.city ?? null,
    },
    meta: { number: note.number, date: note.note_date, dueDate: null, paymentType: null },
    lines: note.lines.map((l) => ({
      id: l.id,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPrice: riyalToMinor(l.unit_price),
      tax: riyalToMinor(l.line_tax),
      total: riyalToMinor(l.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(note.subtotal),
      tax: riyalToMinor(note.tax_amount),
      total: riyalToMinor(note.total),
    },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: note.reason ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
