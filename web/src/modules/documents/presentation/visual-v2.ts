/**
 * أساسيات العرض V2 لقالب Modern فقط.
 * توكنز تركيبية محلية — لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import { getCurrency } from '../constants/currencies';
import type { DocItemsColumnId } from '../types';

export const VISUAL_V2 = {
  /** فواصل طباعية رفيعة بلا بطاقات. */
  hairline: 'border-[color:var(--border)]',
  sectionLabel: 'text-[10px] font-semibold text-[color:var(--muted)]',
  /** ارتفاع شعار أقصى حتى يبقى الاسم القانوني العنصر الأقوى. */
  logoMaxPx: 36,
  logoMaxWidthClass: 'max-h-9 max-w-[5.5rem] w-auto shrink-0 object-contain object-start',
  qrSizePx: 76,
  totalsMaxClass: 'w-full max-w-[300px]',
} as const;

export type DocumentLabelMode = 'ar' | 'en' | 'bilingual';

/** يحسم وضع التسمية من لغة الواجهة واتجاه المستند دون حقل API جديد. */
export function resolveDocumentLabelMode(locale: string, direction: 'rtl' | 'ltr'): DocumentLabelMode {
  const lang = locale.toLowerCase();
  const isAr = lang === 'ar' || lang.startsWith('ar-');
  const isEn = lang === 'en' || lang.startsWith('en-');
  if (direction === 'rtl' && isAr) return 'ar';
  if (direction === 'ltr' && isEn) return 'en';
  return 'bilingual';
}

/**
 * يركّب تسمية مزدوجة دون تكرار القيمة المشتركة.
 * في الوضع ثنائي اللغة تبقى العربية أولاً كما في المستند النظامي السعودي.
 */
export function pairLabel(ar: string, en: string, mode: DocumentLabelMode): string {
  const a = ar.trim();
  const e = en.trim();
  if (mode === 'ar') return a;
  if (mode === 'en') return e;
  if (!a) return e;
  if (!e || a === e) return a;
  return `${a} | ${e}`;
}

/** يحوّل ترجمة الواجهة الحالية + البديل إلى زوج عربي/إنجليزي حسب لغة الواجهة. */
export function localizedPair(
  locale: string,
  primary: string,
  alternate: string,
  mode: DocumentLabelMode,
): string {
  const isAr = locale.toLowerCase().startsWith('ar');
  const ar = isAr ? primary : alternate;
  const en = isAr ? alternate : primary;
  return pairLabel(ar, en, mode);
}

export const MODERN_FIELD_LABELS = {
  vat_number: { ar: 'الرقم الضريبي', en: 'VAT No.' },
  cr_number: { ar: 'السجل التجاري', en: 'CR' },
  number: { ar: 'رقم الفاتورة', en: 'Invoice No.' },
  document_number: { ar: 'رقم المستند', en: 'Document number' },
  date: { ar: 'التاريخ', en: 'Date' },
  due_date: { ar: 'الاستحقاق', en: 'Due' },
  payment_type: { ar: 'نوع الدفع', en: 'Payment' },
  cash: { ar: 'نقدي', en: 'Cash' },
  credit: { ar: 'آجل', en: 'Credit' },
  seller: { ar: 'المورد / المنشأة', en: 'From' },
  company: { ar: 'المنشأة', en: 'Company' },
  buyer: { ar: 'فاتورة إلى', en: 'Bill to' },
  purchase_buyer: { ar: 'المشتري', en: 'Buyer' },
  customer: { ar: 'العميل', en: 'Customer' },
  supplier: { ar: 'المورد', en: 'Supplier' },
  recipient: { ar: 'المستلم', en: 'Recipient' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  terms: { ar: 'الشروط', en: 'Terms' },
  bank: { ar: 'البيانات البنكية', en: 'Bank' },
  signature: { ar: 'التوقيع', en: 'Signature' },
  national_address: { ar: 'العنوان الوطني', en: 'National address' },
  city: { ar: 'المدينة', en: 'City' },
  zatca_note: { ar: 'رمز الاستجابة السريعة (هيئة الزكاة والضريبة)', en: 'QR code (ZATCA)' },
  amount_words: { ar: 'المبلغ بالحروف', en: 'Amount in words' },
  valid_until: { ar: 'صالح حتى', en: 'Valid until' },
  expected_delivery_date: { ar: 'التاريخ المتوقع للتسليم', en: 'Expected delivery date' },
  delivery_date: { ar: 'تاريخ التسليم', en: 'Delivery date' },
  payment_due_date: { ar: 'تاريخ الاستحقاق', en: 'Due date' },
  received_from: { ar: 'استلمنا من', en: 'Received from' },
  paid_to: { ar: 'صرفنا إلى', en: 'Paid to' },
  amount: { ar: 'المبلغ', en: 'Amount' },
  method: { ar: 'طريقة الدفع', en: 'Payment method' },
  reference: { ar: 'المرجع', en: 'Reference' },
  applied_to: { ar: 'مخصوم من المستندات', en: 'Applied to documents' },
  footer: {
    ar: 'هذه فاتورة إلكترونية صادرة وفق متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA).',
    en: 'This is an electronic invoice issued per ZATCA (Zakat, Tax and Customs Authority) requirements.',
  },
} as const;

export function modernFieldLabel(
  key: keyof typeof MODERN_FIELD_LABELS,
  mode: DocumentLabelMode,
): string {
  const pair = MODERN_FIELD_LABELS[key];
  return pairLabel(pair.ar, pair.en, mode);
}

export const MODERN_COLUMN_LABELS: Record<DocItemsColumnId, { ar: string; en: string }> = {
  number: { ar: '#', en: '#' },
  product: { ar: 'المنتج', en: 'Product' },
  description: { ar: 'الوصف', en: 'Description' },
  product_code: { ar: 'رمز المنتج', en: 'Product code' },
  barcode: { ar: 'الباركود', en: 'Barcode' },
  quantity: { ar: 'الكمية', en: 'Qty' },
  unit_price: { ar: 'سعر الوحدة', en: 'Unit price' },
  price_before_tax: { ar: 'السعر قبل الضريبة', en: 'Price before tax' },
  tax: { ar: 'الضريبة', en: 'Tax' },
  total: { ar: 'الإجمالي', en: 'Total' },
};

export function modernColumnLabel(column: DocItemsColumnId, mode: DocumentLabelMode): string {
  const pair = MODERN_COLUMN_LABELS[column];
  return pairLabel(pair.ar, pair.en, mode);
}

export const MODERN_TOTAL_LABELS = {
  subtotal: { ar: 'المجموع قبل الضريبة', en: 'Subtotal (excl. VAT)' },
  discount: { ar: 'خصم الفاتورة', en: 'Invoice discount' },
  shipping: { ar: 'الشحن', en: 'Shipping' },
  adjustment: { ar: 'تسوية / تقريب', en: 'Adjustment' },
  vat: { ar: 'ضريبة القيمة المضافة (15%)', en: 'VAT (15%)' },
  grand_total: { ar: 'الإجمالي شامل الضريبة', en: 'Total (incl. VAT)' },
} as const;

export function modernTotalLabel(
  key: keyof typeof MODERN_TOTAL_LABELS,
  mode: DocumentLabelMode,
): string {
  const pair = MODERN_TOTAL_LABELS[key];
  return pairLabel(pair.ar, pair.en, mode);
}

export const MODERN_STATUS_LABELS = {
  draft: { ar: 'مسودة', en: 'Draft' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
} as const;

export function modernStatusLabel(status: 'draft' | 'cancelled', mode: DocumentLabelMode): string {
  const pair = MODERN_STATUS_LABELS[status];
  return pairLabel(pair.ar, pair.en, mode);
}

export function isNoticeStatus(status: string | null | undefined): status is 'draft' | 'cancelled' {
  return status === 'draft' || status === 'cancelled';
}

/** يحدّ ارتفاع الشعار حتى لا يتجاوز سقف Modern. */
export function cappedLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return VISUAL_V2.logoMaxPx;
  return Math.min(requested, VISUAL_V2.logoMaxPx);
}

export const MODERN_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[10px] leading-snug';
export const MODERN_ITEMS_HEAD_CLASS = 'border-b border-[color:var(--border)] text-black';
export const MODERN_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

const MODERN_MONEY_COLUMNS = new Set<DocItemsColumnId>([
  'unit_price',
  'price_before_tax',
  'tax',
  'total',
]);

export function isModernMoneyColumn(column: DocItemsColumnId): boolean {
  return MODERN_MONEY_COLUMNS.has(column);
}

/**
 * عرض عمود Modern داخل table-fixed.
 * مجموع الأعمدة العشرة الافتراضية = 100% حتى لا يتراكب الباركود مع المنتج.
 */
export function modernItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[3%]';
    case 'product_code':
      return 'w-[8%]';
    case 'barcode':
      return 'w-[8%]';
    case 'product':
      return 'w-[19%]';
    case 'description':
      return 'w-[21%]';
    case 'quantity':
      return 'w-[5%]';
    case 'unit_price':
      return 'w-[8%]';
    case 'price_before_tax':
      return 'w-[10%]';
    case 'tax':
      return 'w-[8%]';
    case 'total':
      return 'w-[10%]';
  }
}

export function modernItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'product' || column === 'description') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-snug';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-tight';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px]';
  }
  return 'whitespace-nowrap text-[10px]';
}

/** حشو أضيق للرأس والخلايا المالية حتى لا تضغط الأرقام الوحدة داخل الخلية. */
export function modernItemsCellPadding(column: DocItemsColumnId): string {
  return isModernMoneyColumn(column) || column === 'number' || column === 'quantity'
    ? 'px-1 py-1.5'
    : 'px-1.5 py-1.5';
}

/** مجموع نسب الأعمدة الافتراضية العشرة — حارس ضد التراكب. */
export const MODERN_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(modernItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);

/**
 * وحدة عرض Modern فقط. لا تلمس منسّق الواجهة العام (`formatMoney` / U+20C1).
 * SAR: «ريال» عربياً، و`SAR` في الإنجليزية والوضع الثنائي. غير SAR يبقى رمز السجل.
 */
export function modernCurrencyUnit(currency: string, mode: DocumentLabelMode): string {
  const code = currency.trim().toUpperCase() || 'SAR';
  if (code === 'SAR') {
    return mode === 'ar' ? 'ريال' : 'SAR';
  }
  return getCurrency(code).symbol;
}

/** الرقم فقط بنفس دقة المحرّك (قسمة على 10^precision + Intl en-US). */
export function formatModernAmount(minor: number, currency: string): string {
  const cfg = getCurrency(currency);
  const n = Number(minor);
  if (!Number.isFinite(n)) return '—';
  const value = n / 10 ** cfg.precision;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: cfg.precision,
    maximumFractionDigits: cfg.precision,
  }).format(value);
}

/** رقم + وحدة للإجماليات في Modern. */
export function formatModernMoney(minor: number, currency: string, mode: DocumentLabelMode): string {
  const amount = formatModernAmount(minor, currency);
  if (amount === '—') return amount;
  return `${amount} ${modernCurrencyUnit(currency, mode)}`;
}

/** رأس عمود مالي يذكر الوحدة مرة واحدة: «الإجمالي (ريال)» / «Total (SAR)». */
export function modernMoneyColumnHeader(label: string, currency: string, mode: DocumentLabelMode): string {
  return `${label} (${modernCurrencyUnit(currency, mode)})`;
}
