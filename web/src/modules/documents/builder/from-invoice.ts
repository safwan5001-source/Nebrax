import { riyalToMinor } from '@/lib/money';
import { getCurrency } from '../constants/currencies';
import type { CurrencyCode, Direction, DocumentModel, DocumentTypeId } from '../types';

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
  /** حقول قائمة على عقد الفاتورة؛ اختيارية حتى لا ينكسر مستدعو POS والمعاينة. */
  due_date?: string | null;
  status?: string | null;
  discount?: string;
  shipping?: string;
  adjustment?: string;
  lines: SourceInvoiceLine[];
}
export interface SourceCompany {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
  /** شعار هوية المنشأة كما يعيده /me؛ يُستخدم عند غياب شعار مخصص لتصميم الفاتورة. */
  logo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  building_no?: string | null;
  street?: string | null;
  additional_no?: string | null;
  district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  short_address?: string | null;
  /** عملة المؤسسة من /me؛ المحرّك ينسّق بها ولا يفترض SAR. */
  currency?: string | null;
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
 * يمرّر مبلغاً قائماً من المصدر إلى الهللات إن وُجد وكان غير صفر.
 * لا يشتق الإجماليات ولا يملأ صفراً يُعرض كسطر فارغ.
 */
function optionalSourceMinor(value?: string | null): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = riyalToMinor(value);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
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
  /** نوع الكتالوج؛ الافتراضي فاتورة ضريبية قياسية للتوافق مع المستدعين القدامى. */
  type?: DocumentTypeId;
  /** اتجاه المستند؛ الافتراضي RTL لسياق أَوْج. */
  direction?: Direction;
}): DocumentModel {
  const { invoice, company, customer, qr, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;
  const currency = getCurrency(company?.currency).code as CurrencyCode;

  return {
    type: input.type ?? 'tax_invoice',
    currency,
    direction: input.direction ?? 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      address: buildNationalAddress(company),
      phone: company?.phone?.trim() || null,
      mobile: company?.mobile?.trim() || null,
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
      dueDate: invoice.due_date?.trim() || null,
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
      discount: optionalSourceMinor(invoice.discount),
      shipping: optionalSourceMinor(invoice.shipping),
      adjustment: optionalSourceMinor(invoice.adjustment),
      tax: riyalToMinor(invoice.tax_amount),
      total: riyalToMinor(invoice.total),
    },
    status: invoice.status?.trim() || null,
    qr: qr ? { value: qr } : null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: invoice.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
