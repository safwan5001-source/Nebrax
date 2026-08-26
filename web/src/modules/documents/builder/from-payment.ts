import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';
import { buildDocumentSeller } from './company-seller';

/** تخصيص سند من الـ API — نصّ الوصف والمبلغ بالريال نصّاً. */
export interface SourcePaymentAllocation {
  label: string;
  amount: string;
}

/** أشكال مصدر السند (عقد الـ API للدفعة) — المبالغ بالريال نصّاً. */
export interface SourcePayment {
  number: string;
  payment_date: string;
  direction: string; // received | paid
  method: string;    // نصّ الطريقة (مترجَم مسبقاً في طبقة العرض)
  amount: string;
  reference?: string | null;
  notes?: string | null;
  allocations?: SourcePaymentAllocation[];
}

/**
 * يبني `DocumentModel` من دفعة (سند قبض/صرف). لا بنود ولا ضريبة — المحتوى الجوهري
 * في `voucher`؛ يعيد استخدام نفس القوالب والأقسام (ترويسة/أطراف/توقيع/ختم/تذييل).
 */
export function buildPaymentDocumentModel(input: {
  payment: SourcePayment;
  company: SourceCompany | null;
  partner: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  const { payment, company, partner, footerText, logoUrl, logoHeight, bank, stampUrl, signatureUrl } = input;
  const isReceived = payment.direction === 'received';
  const amount = riyalToMinor(payment.amount);
  const seller = buildDocumentSeller(company, { logoUrl, logoHeight });

  return {
    type: isReceived ? 'receipt_voucher' : 'payment_voucher',
    currency: 'SAR',
    direction: 'rtl',
    seller,
    buyer: {
      name: partner?.name ?? '—',
      vatNumber: partner?.vat_number ?? null,
      city: partner?.city ?? null,
    },
    meta: { number: payment.number, date: payment.payment_date, dueDate: null, paymentType: null },
    lines: [],
    totals: { subtotal: amount, tax: 0, total: amount },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: payment.notes ?? null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
    voucher: {
      direction: isReceived ? 'received' : 'paid',
      method: payment.method,
      amount,
      reference: payment.reference ?? null,
      allocations: (payment.allocations ?? []).map((a) => ({ label: a.label, amount: riyalToMinor(a.amount) })),
    },
  };
}
