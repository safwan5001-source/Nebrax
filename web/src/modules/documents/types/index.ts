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
  | 'purchase_invoice'
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
  logoUrl?: string | null;  // صورة الشعار (data URL أو رابط)
  logoHeight?: number | null; // ارتفاع عرض الشعار بالبكسل
  tagline?: string | null;
}

/** سطر بند — كل المبالغ بالوحدات الصغرى. */
export interface DocumentLine {
  id: string;
  /** لقطة هوية المنتج؛ تبقى اختيارية لمستندات لا تملك كتالوج منتجات. */
  productName?: string | null;
  productCode?: string | null;
  barcode?: string | null;
  description: string;
  quantity: number;
  unitPrice: number; // minor units
  /** سعر الوحدة قبل الضريبة؛ تجهزه طبقة المصدر ولا يُشتق في العارض. */
  priceBeforeTax?: number | null;
  tax: number;       // minor units
  total: number;     // minor units (شامل الضريبة للسطر)
}

/** إجماليات المستند — بالوحدات الصغرى. */
export interface DocumentTotals {
  subtotal: number;
  discount?: number;
  shipping?: number;
  /** فرق تسوية موجب أو سالب؛ يستخدمه الشراء للحفاظ على تطابق الإجمالي المطبوع. */
  adjustment?: number;
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

/** تخصيص سند (فاتورة/مشترى غطّاه السند) — المبلغ بالوحدات الصغرى. */
export interface DocumentVoucherAllocation {
  label: string;
  amount: number; // minor units
}

/**
 * بيانات السند (قبض/صرف) — المحتوى الجوهري لمستند لا يحمل بنوداً/ضريبة:
 * اتجاه الحركة، الطريقة، المبلغ، وما غطّاه من مستندات.
 */
export interface DocumentVoucher {
  direction: 'received' | 'paid';
  method: string;         // نقدي/تحويل/شيك… (نصّ مترجَم مسبقاً)
  amount: number;         // minor units
  reference?: string | null;
  allocations?: DocumentVoucherAllocation[];
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
  /** ملاحظات المستند (من السجلّ نفسه). */
  notes?: string | null;
  /** الشروط والأحكام (من إعدادات التصاميم). */
  terms?: string | null;
  /** البيانات البنكية (نصّ، من إعدادات التصاميم). */
  bank?: string | null;
  /** ختم الشركة (data URL، من إعدادات التصاميم). */
  stampUrl?: string | null;
  /** التوقيع (data URL، من إعدادات التصاميم). */
  signatureUrl?: string | null;
  /** بيانات السند (قبض/صرف) — للمستندات من نوع voucher فقط. */
  voucher?: DocumentVoucher | null;
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
  voucher: boolean;
  amountWords: boolean;
  qr: boolean;
  barcode: boolean;
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
  /** إظهار شريط الهوية أسفل الترويسة. */
  brandBar: boolean;
}

/**
 * مفاتيح الأقسام القابلة للترتيب/الإظهار في مصمّم المستند.
 * `voucher` مستثنى من `DEFAULT_SECTION_ORDER` (فلا يظهر في مصمّم الفواتير) — تستدعيه
 * مستندات السند عبر تخطيط صريح.
 */
export type DocSectionKey =
  | 'header' | 'barcode' | 'parties' | 'items' | 'summary' | 'voucher'
  | 'amountWords' | 'notes' | 'terms' | 'bank' | 'stamp' | 'signature' | 'footer';

/** محاذاة منطقية متوافقة مع RTL/LTR؛ لا تستعمل `left` أو `right`. */
export type DocBlockAlignment = 'start' | 'center' | 'end';

/** درجات حجم النص المتاحة للكتل؛ تبقى عائلة الخط من قالب المستند نفسه. */
export type DocBlockFontSize = 'sm' | 'md' | 'lg';
/** حجم نسبي آمن لكتل الصور؛ غيابه يبقي المراجعات التاريخية على مظهرها الأصلي. */
export type DocBlockImageSize = 'sm' | 'md' | 'lg';
/** شفافية مقيدة لكتل الصور؛ غيابها يحفظ المظهر التاريخي الخاص بكل كتلة. */
export type DocBlockImageOpacity = 'solid' | 'soft' | 'faint';

/** أعمدة جدول البنود التي يستطيع العارض رسمها بالفعل. */
export type DocItemsColumnId =
  | 'number' | 'description' | 'product_code' | 'barcode'
  | 'quantity' | 'price_before_tax' | 'unit_price' | 'tax' | 'total';

/** تخصيص عمود واحد: عنوان ثابت اختياري ومحاذاة منطقية. */
export interface DocItemsColumn {
  id: DocItemsColumnId;
  label?: string;
  alignment?: DocBlockAlignment;
}

/**
 * خصائص اختيارية ملازمة للكتلة في تخطيطها. العقد الخلفي وسجل أنواع المستندات
 * يحددان المفاتيح المسموحة لكل كتلة؛ يظل هذا النوع واسعاً لتفادي تمثيل منفصل
 * لكل عنصر تخطيط قبل التحقق وقت الحفظ.
 */
export interface DocSectionProperties {
  columns?: DocItemsColumn[];
  alignment?: DocBlockAlignment;
  font_size?: DocBlockFontSize;
  image_size?: DocBlockImageSize;
  image_opacity?: DocBlockImageOpacity;
  static_content?: string;
}

/** خصائص مفهرسة بمفتاح الكتلة، تلحق بتعريف القالب والمراجعة المثبتة. */
export type DocBlockPropertiesMap = Partial<Record<DocSectionKey, DocSectionProperties>>;

/** عنصر تخطيط: قسم + ظهوره وخصائصه المصرح بها. ترتيب المصفوفة = ترتيب العرض. */
export interface DocSectionLayoutItem {
  key: DocSectionKey;
  visible: boolean;
  properties?: DocSectionProperties;
}

/** الترتيب الافتراضي للأقسام (يطابق التركيب الأصلي). */
export const DEFAULT_SECTION_ORDER: DocSectionKey[] = [
  'header', 'barcode', 'parties', 'items', 'summary', 'amountWords',
  'notes', 'terms', 'bank', 'stamp', 'signature', 'footer',
];

/** خصائص كل قالب — يستقبل النموذج ومنسّق العملة والثيم والإعداد. */
export interface DocumentTemplateProps {
  model: DocumentModel;
  theme: DocumentTheme;
  /** منسّق مبلغ (وحدات صغرى) → نصّ العملة. */
  formatMoney: (minor: number) => string;
  sections?: Partial<TemplateSectionsConfig>;
  /** تخطيط مخصّص (ترتيب/إظهار الأقسام) من مصمّم المستند؛ يتجاوز الترتيب الافتراضي. */
  layout?: DocSectionLayoutItem[] | null;
  /** خصائص الكتل المعتمدة من المراجعة؛ لا يعاد حل إعداد حي عند وجودها. */
  blockProperties?: DocBlockPropertiesMap | null;
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
