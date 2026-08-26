import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';

/**
 * أشكال المصدر (عقد الـ API للفاتورة) — المبالغ بالريال نصّاً كما يعيدها الـ backend.
 * تُعرَّف هنا فيبقى المحرّك مستقلّاً عن مكوّنات الشاشة.
 */
export interface SourceInvoiceLine {
  id: string;
  product_name?: string | null;
  product_code?: string | null;
  barcode?: string | null;
  description: string | null;
  quantity: number;
  unit_price: string;
  unit_price_before_tax?: string | null;
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
  name_en?: string | null;
  vat_number?: string | null;
  cr_number?: string | null;
  unified_number?: string | null;
  /** شعار هوية المنشأة كما يعيده /me؛ يُستخدم عند غياب شعار مخصص لتصميم الفاتورة. */
  logo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  website?: string | null;
  support_number?: string | number | null;
  building_no?: string | null;
  street?: string | null;
  additional_no?: string | null;
  district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  short_address?: string | null;
}
export interface SourceCustomer {
  name: string;
  vat_number?: string | null;
  city?: string | null;
}

/**
 * يفضّل العنوان الوطني التفصيلي في المستند؛ ويظل العنوان المختصر احتياطاً حين
 * لا تكتمل عناصره. لا يُظهر صف عنوان فارغاً في الفواتير التاريخية.
 */
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

  const seller = {
    name: company?.name ?? '—',
    nameEn: company?.name_en?.trim() || null,
    vatNumber: company?.vat_number ?? null,
    crNumber: company?.cr_number ?? null,
    unifiedNumber: company?.unified_number?.trim() || null,
    address: buildNationalAddress(company),
    phone: company?.phone?.trim() || null,
    mobile: company?.mobile?.trim() || null,
    email: company?.email?.trim() || null,
    website: company?.website?.trim() || null,
    supportNumber: company?.support_number ?? null,
    tagline: null,
    logoText: null,
    // أولوية الشعار: تصميم الفاتورة المخصص ثم شعار هوية المؤسسة. لا تُظهر علامة
    // احتياطية ما دام الشعار المرفوع للشركة متوفراً عبر /me.
    logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : (company?.logo ?? null),
    logoHeight: logoHeight ?? null,
  };

  return {
    type: 'tax_invoice',
    currency: 'SAR',
    direction: 'rtl',
    seller,
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
      productName: l.product_name ?? l.description ?? null,
      productCode: l.product_code ?? null,
      barcode: l.barcode ?? null,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPrice: riyalToMinor(l.unit_price),
      priceBeforeTax: l.unit_price_before_tax === null || l.unit_price_before_tax === undefined
        ? null
        : riyalToMinor(l.unit_price_before_tax),
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
