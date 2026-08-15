import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';

/**
 * أشكال المصدر (عقد الـ API للفاتورة) — المبالغ بالريال نصّاً كما يعيدها الـ backend.
 * تُعرَّف هنا فيبقى المحرّك مستقلّاً عن مكوّنات الشاشة.
 */
export interface SourceInvoiceLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: number;
  line_tax: string;
  line_total: string;
}
export interface SourceInvoice {
  number: string;
  invoice_date: string;
  payment_type: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes?: string | null;
  lines: SourceInvoiceLine[];
}
export interface SourceCompany {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
  /** شعار هوية المنشأة كما يعيده /me؛ يُستخدم عند غياب شعار مخصص لتصميم الفاتورة. */
  logo?: string | null;
}
export interface SourceCustomer {
  name: string;
  vat_number?: string | null;
  city?: string | null;
}

/**
 * يبني `DocumentModel` من بيانات فاتورة الـ API. المبالغ تُحوَّل من الريال إلى
 * الوحدات الصغرى (هللات) مرّة واحدة، فيُنسّقها المحرّك حسب العملة عند العرض.
 */
export function buildInvoiceDocumentModel(input: {
  invoice: SourceInvoice;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
  qr: string | null;
  /** نصّ تذييل مخصّص (من إعدادات التصاميم)؛ يتراجع لنصّ الترجمة حين فارغ. */
  footerText?: string | null;
  /** شعار مرفوع (data URL) وارتفاعه بالبكسل — من إعدادات التصاميم. */
  logoUrl?: string | null;
  logoHeight?: number | null;
  /** الشروط والأحكام — من إعدادات التصاميم. */
  terms?: string | null;
  /** بيانات بنكية/ختم/توقيع — من إعدادات التصاميم. */
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  const { invoice, company, customer, qr, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;

  return {
    type: 'tax_invoice',
    currency: 'SAR',
    direction: 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      // أولوية الشعار: تصميم الفاتورة المخصص ثم شعار هوية المؤسسة. لا تُظهر علامة
      // احتياطية ما دام الشعار المرفوع للشركة متوفراً عبر /me.
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : (company?.logo ?? null),
      logoHeight: logoHeight ?? null,
    },
    buyer: {
      name: customer?.name ?? '—',
      vatNumber: customer?.vat_number ?? null,
      city: customer?.city ?? null,
    },
    meta: {
      number: invoice.number,
      date: invoice.invoice_date,
      paymentType: invoice.payment_type === 'cash' ? 'cash' : 'credit',
    },
    lines: invoice.lines.map((l) => ({
      id: l.id,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPrice: riyalToMinor(l.unit_price),
      tax: riyalToMinor(l.line_tax),
      total: riyalToMinor(l.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(invoice.subtotal),
      tax: riyalToMinor(invoice.tax_amount),
      total: riyalToMinor(invoice.total),
    },
    qr: qr ? { value: qr } : null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: invoice.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
