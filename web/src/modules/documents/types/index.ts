/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Nebrax Document Engine — النماذج الأساسية (Core Types)
 * ═══════════════════════════════════════════════════════════════════════════
 *  مصدر حقيقة واحد لكل المستندات (فاتورة/عرض سعر/سند…). القوالب تستهلك
 *  `DocumentModel` فقط، فلا يوجد تكرار: نموذج واحد ← قوالب متعددة.
 *
 *  كل المبالغ بالوحدات الصغرى (هللات/سنتات) كأعداد صحيحة — لا `float` إطلاقاً؛
 *  التنسيق إلى عملة يتمّ في طبقة العرض عبر محرّك العملة.
 */

export type Direction = 'rtl' | 'ltr' | 'auto';

/** أنواع المستندات التي يدعمها المحرّك (تتوسّع تدريجياً). */
export type DocumentTypeId =
  | 'tax_invoice'
  | 'simplified_tax_invoice'
  | 'quotation'
  | 'proforma_invoice'
  | 'sales_order'
  | 'purchase_order'
  | 'delivery_note'
  | 'packing_list'
  | 'receipt_voucher'
  | 'payment_voucher'
  | 'credit_note'
  | 'debit_note'
  | 'statement_of_account';

/** أكواد العملات المدعومة (ISO 4217). */
export type CurrencyCode =
  | 'SAR' | 'USD' | 'EUR' | 'AED' | 'QAR'
  | 'OMR' | 'KWD' | 'BHD' | 'EGP' | 'GBP' | 'JPY';

export type PaperSizeId = 'a4' | 'a4_landscape' | 'letter' | 'legal' | 'thermal_58' | 'thermal_80';

export type ThemeId = 'blue' | 'green' | 'orange' | 'purple' | 'gray' | 'black' | 'custom';

/** طرف في المستند (البائع/المشتري). */
export interface DocumentParty {
  name: string;
  vatNumber?: string | null;
  crNumber?: string | null;
  city?: string | null;
  address?: string | null;
}

/** البائع = طرف + هوية بصرية اختيارية. */
export interface DocumentSeller extends DocumentParty {
  logoText?: string | null; // نص شعار احتياطي حين لا توجد صورة
  logoUrl?: string | null;
  tagline?: string | null;
}

/** سطر بند — كل المبالغ بالوحدات الصغرى. */
export interface DocumentLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number; // minor units
  tax: number;       // minor units
  total: number;     // minor units (شامل الضريبة للسطر)
}

/** إجماليات المستند — بالوحدات الصغرى. */
export interface DocumentTotals {
  subtotal: number;
  discount?: number;
  shipping?: number;
  tax: number;
  total: number;
}

/** بيانات ترويسة المستند. */
export interface DocumentMeta {
  number: string;
  date: string;
  dueDate?: string | null;
  paymentType?: 'cash' | 'credit' | null;
}

/** رمز ZATCA (أو أي هيئة لاحقاً) — قيمة QR جاهزة. */
export interface DocumentQr {
  value: string;
  note?: string | null;
}

/**
 * نموذج المستند الموحّد — ما تستهلكه كل القوالب.
 */
export interface DocumentModel {
  type: DocumentTypeId;
  currency: CurrencyCode;
  direction: Direction;
  seller: DocumentSeller;
  buyer: DocumentParty;
  meta: DocumentMeta;
  lines: DocumentLine[];
  totals: DocumentTotals;
  qr?: DocumentQr | null;
  footerText?: string | null;
}

/** توكنز الثيم (تُسقَط إلى متغيّرات CSS). */
export interface ThemeTokens {
  /** لون الهوية الأساسي للمستند. */
  brand: string;
  /** لون النص فوق خلفية الهوية (تباين). */
  brandContrast: string;
  /** خلفية خفيفة مشتقّة من الهوية (رؤوس/تظليل). */
  brandSoft: string;
}

export interface DocumentTheme {
  id: ThemeId;
  tokens: ThemeTokens;
}

/**
 * إعداد القالب — أي الأقسام تظهر، الثيم، الورق، اللغة/الاتجاه، العملة.
 * كل قسم اختياري (Document Builder).
 */
export interface TemplateSectionsConfig {
  logo: boolean;
  header: boolean;
  seller: boolean;
  buyer: boolean;
  meta: boolean;
  items: boolean;
  summary: boolean;
  qr: boolean;
  terms: boolean;
  notes: boolean;
  bank: boolean;
  stamp: boolean;
  signature: boolean;
  footer: boolean;
}

export interface TemplateConfig {
  templateId: string;
  theme: ThemeId;
  paper: PaperSizeId;
  direction: Direction;
  sections: Partial<TemplateSectionsConfig>;
}

/**
 * توكنز أسلوب القالب — تُمرَّر للأقسام (عبر Context) فتتغيّر هوية القالب البصرية
 * دون تكرار منطق الأقسام. قالب واحد من الأقسام، مُعامَل بهذه التوكنز.
 */
export interface TemplateStyle {
  /** حشو غلاف الصفحة (Tailwind). */
  pagePadding: string;
  /** زوايا البطاقات/الحاويات. */
  cardRadius: string;
  /** الفاصل الرأسي بين الأقسام. */
  sectionGap: string;
  /** نمط رأس جدول البنود. */
  tableHead: 'brand' | 'soft' | 'plain';
}

/** خصائص كل قالب — يستقبل النموذج ومنسّق العملة والثيم والإعداد. */
export interface DocumentTemplateProps {
  model: DocumentModel;
  theme: DocumentTheme;
  /** منسّق مبلغ (وحدات صغرى) → نصّ العملة. */
  formatMoney: (minor: number) => string;
  sections?: Partial<TemplateSectionsConfig>;
  /**
   * معرّف عنصر الجذر: 'print-root' (افتراضي) لمصدر الطباعة/التصدير،
   * أو `null` لمعاينة لا تخطف الطباعة (كمعاينة الإعدادات).
   */
  rootId?: string | null;
}

/** بيانات تسجيل قالب في السجلّ (Template Registry). */
export interface TemplateDescriptor {
  id: string;
  /** مفتاح ترجمة الاسم (namespace: invoiceTemplates). */
  nameKey: string;
  component: React.ComponentType<DocumentTemplateProps>;
  defaultTheme: ThemeId;
  supportedPaper: PaperSizeId[];
}
