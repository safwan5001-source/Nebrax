/**
 * أساسيات العرض V2 لقالب Modern فقط.
 * توكنز تركيبية محلية — لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const VISUAL_V2 = {
  /** فواصل طباعية رفيعة بلا بطاقات. */
  hairline: 'border-[color:var(--border)]',
  sectionLabel: 'text-[10px] font-semibold text-[color:var(--muted)]',
  /** ارتفاع شعار أقصى حتى لا يهيمن على الرأس. */
  logoMaxPx: 48,
  logoMaxWidthClass: 'max-h-12 max-w-[7.5rem] w-auto shrink-0 object-contain',
  qrSizePx: 88,
  totalsMaxClass: 'w-full max-w-[280px]',
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
  date: { ar: 'التاريخ', en: 'Date' },
  due_date: { ar: 'الاستحقاق', en: 'Due' },
  payment_type: { ar: 'نوع الدفع', en: 'Payment' },
  seller: { ar: 'المورد / المنشأة', en: 'From' },
  buyer: { ar: 'فاتورة إلى', en: 'Bill to' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  terms: { ar: 'الشروط', en: 'Terms' },
  bank: { ar: 'البيانات البنكية', en: 'Bank' },
  signature: { ar: 'التوقيع', en: 'Signature' },
} as const;

export function modernFieldLabel(
  key: keyof typeof MODERN_FIELD_LABELS,
  mode: DocumentLabelMode,
): string {
  const pair = MODERN_FIELD_LABELS[key];
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

export const MODERN_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[11px] leading-snug';
export const MODERN_ITEMS_HEAD_CLASS = 'border-b border-[color:var(--border)] text-black';
export const MODERN_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

/**
 * عرض عمود Modern داخل table-fixed.
 * مجموع الأعمدة العشرة الافتراضية = 100% حتى لا يتراكب الباركود مع المنتج.
 */
export function modernItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[4%]';
    case 'product_code':
      return 'w-[9%]';
    case 'barcode':
      return 'w-[10%]';
    case 'product':
      return 'w-[16%]';
    case 'description':
      return 'w-[18%]';
    case 'quantity':
      return 'w-[6%]';
    case 'unit_price':
      return 'w-[9%]';
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
    return 'min-w-0 break-words whitespace-normal';
  }
  if (column === 'product_code' || column === 'barcode') {
    return 'min-w-0 break-all';
  }
  return 'whitespace-nowrap';
}

/** مجموع نسب الأعمدة الافتراضية العشرة — حارس ضد التراكب. */
export const MODERN_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'unit_price', 'quantity', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(modernItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
