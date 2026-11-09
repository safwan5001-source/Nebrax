import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';

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
  /** حقول يعرضها الـAPI أصلاً (PaymentResource) وتقرؤها القوالب التي تعرضها فقط؛ كلها اختيارية. */
  payment_method_name?: string | null;
  payment_details?: string | null;
  collector_employee_name?: string | null;
  cash_account_name?: string | null;
  cash_account_code?: string | null;
  classification?: { name?: string | null } | null;
  /** اسم الفرع: لا يعرضه الـAPI مع الدفعة (branch_id فقط)، فتحلّه الصفحة من قراءة الفروع إن أمكن. */
  branch_name?: string | null;
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

  return {
    type: isReceived ? 'receipt_voucher' : 'payment_voucher',
    currency: 'SAR',
    direction: 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : null,
      logoHeight: logoHeight ?? null,
    },
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
      methodName: text(payment.payment_method_name),
      paymentDetails: text(payment.payment_details),
      accountName: accountLabel(payment.cash_account_code, payment.cash_account_name),
      collectorName: text(payment.collector_employee_name),
      classificationName: text(payment.classification?.name),
      branchName: text(payment.branch_name),
    },
  };
}

/** نصّ مُقصّ أو `null` — لا قيمة افتراضية ولا تخمين. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function accountLabel(code: string | null | undefined, name: string | null | undefined): string | null {
  const parts = [text(code), text(name)].filter((part): part is string => part !== null);
  return parts.length ? parts.join(' — ') : null;
}
