import type { DocumentModel, DocumentTypeId } from '../types';
import { getDocumentTypeDefinition } from './document-types';

/**
 * بيانات معاينة آمنة ومحددة للمحرر. لا تقرأ قاعدة البيانات ولا تمثل مستنداً حقيقياً؛
 * وبذلك تستطيع واجهة التصميم المعاينة من دون كشف بيانات عميل أو مستأجر.
 */
const PREVIEW_SELLER = {
  name: 'شركة نبراس التجريبية',
  vatNumber: '300000000000003',
  crNumber: '1010101010',
  city: 'الرياض',
  address: 'طريق الملك فهد، الرياض',
  logoText: 'ن',
  logoUrl: null,
  logoHeight: 56,
  tagline: 'إدارة الأعمال بثقة',
};

const PREVIEW_BUYER = {
  name: 'العميل التجريبي',
  vatNumber: '310000000000003',
  crNumber: '2050202020',
  city: 'الدمام',
  address: 'حي الشاطئ، الدمام',
};

const PREVIEW_LINES = [
  {
    id: 'preview-line-1',
    description: 'خدمة استشارية شهرية',
    quantity: 1,
    unitPrice: 100000,
    tax: 15000,
    total: 115000,
  },
  {
    id: 'preview-line-2',
    description: 'اشتراك تشغيلي سنوي',
    quantity: 2,
    unitPrice: 25000,
    tax: 7500,
    total: 57500,
  },
] as const;

function makeLineItemPreview(type: DocumentTypeId): DocumentModel {
  return {
    type,
    currency: 'SAR',
    direction: 'rtl',
    seller: { ...PREVIEW_SELLER },
    buyer: { ...PREVIEW_BUYER },
    meta: {
      number: 'DOC-2026-0001',
      date: '2026-08-15',
      dueDate: '2026-09-14',
      paymentType: 'credit',
    },
    lines: PREVIEW_LINES.map((line) => ({ ...line })),
    totals: {
      subtotal: 150000,
      discount: 0,
      tax: 22500,
      total: 172500,
    },
    qr: type === 'tax_invoice' || type === 'simplified_tax_invoice'
      ? { value: 'Nebrax preview QR payload', note: 'رمز معاينة فقط' }
      : null,
    footerText: 'شكراً لتعاملكم معنا.',
    notes: 'هذه معاينة تجريبية آمنة لمحرر القوالب.',
    terms: 'تسدد الفاتورة خلال 30 يوماً من تاريخ الإصدار.',
    bank: 'البنك الأهلي السعودي — IBAN SA0000000000000000000000',
    stampUrl: null,
    signatureUrl: null,
  };
}

function makeVoucherPreview(type: 'receipt_voucher' | 'payment_voucher'): DocumentModel {
  const received = type === 'receipt_voucher';
  const amount = 172500;

  return {
    type,
    currency: 'SAR',
    direction: 'rtl',
    seller: { ...PREVIEW_SELLER },
    buyer: { ...PREVIEW_BUYER },
    meta: {
      number: received ? 'RCV-2026-0001' : 'PAY-2026-0001',
      date: '2026-08-15',
      dueDate: null,
      paymentType: null,
    },
    lines: [],
    totals: { subtotal: amount, tax: 0, total: amount },
    qr: null,
    footerText: 'شكراً لتعاملكم معنا.',
    notes: 'هذه معاينة تجريبية آمنة لمحرر القوالب.',
    terms: null,
    bank: 'البنك الأهلي السعودي — IBAN SA0000000000000000000000',
    stampUrl: null,
    signatureUrl: null,
    voucher: {
      direction: received ? 'received' : 'paid',
      method: 'تحويل بنكي',
      amount,
      reference: 'REF-2026-0001',
      allocations: [
        { label: 'فاتورة INV-2026-0001', amount: 115000 },
        { label: 'فاتورة INV-2026-0002', amount: 57500 },
      ],
    },
  };
}

/**
 * يعيد نسخة جديدة لكل طلب حتى لا تتسرب تعديلات حالة واجهة المحرر إلى معاينة أخرى.
 */
export function getDocumentPreviewModel(type: DocumentTypeId): DocumentModel {
  const definition = getDocumentTypeDefinition(type);

  if (definition.family === 'voucher') {
    return makeVoucherPreview(type as 'receipt_voucher' | 'payment_voucher');
  }

  return makeLineItemPreview(type);
}
