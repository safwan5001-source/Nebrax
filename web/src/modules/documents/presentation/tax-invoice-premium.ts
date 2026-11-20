/**
 * توكنز وتسميات قالب الفاتورة الضريبية الفاخرة `tax-invoice-premium-v1` فقط
 * (`composition: tax_invoice_premium`).
 *
 * عرض بحت: لا يُحفظ في المراجعة ولا يغيّر عقود التجميد أو الحساب. كل مبلغ يصل من `DocumentModel`
 * كما هو؛ الاشتقاق الوحيد هنا (صفّ «الإجمالي الخاضع») يُعرض فقط حين يثبت بالهللة أنه يطابق
 * الإجمالي المخزَّن (`المجموع − الخصم + الضريبة = الإجمالي`)، وإلا يُحذف الصف بدل اختلاقه.
 */

import type { DocItemsColumnId, DocumentLine, DocumentModel, DocumentTheme, ThemeId } from '../types';

export interface PremiumPalette {
  /** خلفية الترويسة ورؤوس الجداول ومربع الإجمالي. */
  deep: string;
  /** شريط التمييز تحت الترويسة وعناوين الإنجليزية فوق الداكن. */
  accent: string;
  /** خلفية بطاقات الميتا. */
  soft: string;
  /** حدود الشبكة الخفيفة. */
  line: string;
  /** نص ثانوي فوق الفاتح. */
  muted: string;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const HEX = /^#([0-9a-f]{6})$/i;

/** مزج لونين سداسيين (t = نسبة اللون الثاني). يعيد `a` كما هو إن لم يكن أحدهما #rrggbb صالحاً. */
export function mixHex(a: string, b: string, t: number): string {
  const ma = HEX.exec(a.trim());
  const mb = HEX.exec(b.trim());
  if (!ma || !mb) return a;
  const parse = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(ma[1]);
  const [r2, g2, b2] = parse(mb[1]);
  const mix = (x: number, y: number) => clamp(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

/**
 * ألوان التمييز لكل ثيم. الأخضر هو هوية القالب الافتراضية (أخضر غامق + ليموني)؛ بقية الثيمات
 * تُشتق منها الدرجة الغامقة من لون الهوية نفسه. لا `color-mix` في CSS: مصدّر PDF (html2canvas) لا يفسّره.
 */
const ACCENT: Record<Exclude<ThemeId, 'custom'>, string> = {
  green: '#c6f221',
  blue: '#7dd3fc',
  orange: '#fde047',
  purple: '#e9d5ff',
  gray: '#d1d5db',
  black: '#e5e7eb',
};
const DEEP_OVERRIDE: Partial<Record<ThemeId, string>> = { green: '#0b3d2e' };

export function premiumPalette(theme: DocumentTheme): PremiumPalette {
  const { brand, brandSoft } = theme.tokens;
  const deep = DEEP_OVERRIDE[theme.id] ?? mixHex(brand, '#000000', 0.45);
  const accent = theme.id === 'custom' ? mixHex(brand, '#ffffff', 0.7) : ACCENT[theme.id];
  return {
    deep,
    accent,
    soft: theme.id === 'green' ? '#e8efec' : brandSoft,
    line: mixHex(deep, '#ffffff', 0.82),
    muted: mixHex(deep, '#ffffff', 0.38),
  };
}

export const PREMIUM = {
  logoMaxPx: 56,
  qrSizePx: 96,
  /** صفوف جدول البنود الدنيا — صفوف فارغة مرقّمة تكمل النموذج المطبوع كما في المرجع البصري. */
  minTableRows: 10,
} as const;

export type PremiumLabelPair = { ar: string; en: string };

export const PREMIUM_LABELS = {
  invoice_no: { ar: 'رقم الفاتورة', en: 'Invoice No.' },
  issue_date: { ar: 'تاريخ الإصدار', en: 'Issue date' },
  due_date: { ar: 'تاريخ الاستحقاق', en: 'Due date' },
  payment: { ar: 'طريقة الدفع', en: 'Payment' },
  cash: { ar: 'نقدي', en: 'Cash' },
  credit: { ar: 'آجل', en: 'Credit' },
  seller: { ar: 'البائع', en: 'SELLER' },
  buyer: { ar: 'المشتري', en: 'BUYER' },
  trade_name: { ar: 'الاسم التجاري', en: 'Trade name' },
  customer_name: { ar: 'اسم العميل / المنشأة', en: 'Customer / Company' },
  vat_no: { ar: 'الرقم الضريبي', en: 'VAT No.' },
  cr_no: { ar: 'السجل التجاري', en: 'CR No.' },
  address: { ar: 'العنوان', en: 'Address' },
  phone: { ar: 'الهاتف', en: 'Phone' },
  vat: { ar: 'ضريبة القيمة المضافة', en: 'VAT' },
  taxable_total: { ar: 'الإجمالي الخاضع للضريبة', en: 'Total taxable amount' },
  notes_terms: { ar: 'ملاحظات وشروط الدفع', en: 'Notes & payment terms' },
  bank_details: { ar: 'بيانات التحويل البنكي', en: 'Bank details' },
  qr_caption: { ar: 'رمز الاستجابة السريعة', en: 'QR code' },
  amount_words: { ar: 'المبلغ كتابةً', en: 'Amount in words' },
  received_by: { ar: 'المستلم / التوقيع', en: 'Received by' },
  seller_signature: { ar: 'البائع / التوقيع والختم', en: 'Seller signature & stamp' },
} as const satisfies Record<string, PremiumLabelPair>;

export type PremiumLabelKey = keyof typeof PREMIUM_LABELS;

/** أعمدة القالب: أعمدة المحرك المعتمدة + «الوحدة» عمودٌ داخلي لا يحمله عقد المحرر. */
export type PremiumColumnId = DocItemsColumnId | 'unit';

export interface PremiumColumn {
  id: PremiumColumnId;
  /** تسمية تغلب الافتراضي (مثلاً سعر الوحدة قبل الضريبة يُسمّى «سعر الوحدة» كما في المرجع). */
  label?: PremiumLabelPair;
}

export const PREMIUM_COLUMN_LABELS: Record<PremiumColumnId, PremiumLabelPair> = {
  number: { ar: 'م', en: 'No' },
  product: { ar: 'الصنف / الوصف', en: 'Item / Description' },
  description: { ar: 'الوصف', en: 'Description' },
  product_code: { ar: 'رمز الصنف', en: 'Code' },
  barcode: { ar: 'الباركود', en: 'Barcode' },
  unit: { ar: 'الوحدة', en: 'Unit' },
  quantity: { ar: 'الكمية', en: 'Qty' },
  unit_price: { ar: 'سعر الوحدة', en: 'Unit price' },
  price_before_tax: { ar: 'السعر قبل الضريبة', en: 'Price excl. VAT' },
  line_discount: { ar: 'الخصم', en: 'Discount' },
  line_net: { ar: 'الخاضع للضريبة', en: 'Taxable amt' },
  tax_rate: { ar: 'نسبة الضريبة', en: 'VAT %' },
  tax: { ar: 'مبلغ الضريبة', en: 'VAT amt' },
  total: { ar: 'الإجمالي', en: 'Total' },
};

/** وزن عرض كل عمود؛ يُطبَّع إلى نسب مئوية على الأعمدة الظاهرة فقط فيبقى المجموع 100%. */
const COLUMN_WEIGHT: Record<PremiumColumnId, number> = {
  number: 4,
  product: 25,
  description: 22,
  product_code: 9,
  barcode: 10,
  unit: 8,
  quantity: 7,
  unit_price: 10,
  price_before_tax: 10,
  line_discount: 8,
  line_net: 11,
  tax_rate: 7,
  tax: 9,
  total: 10,
};

export function premiumColumnWidths(columns: readonly PremiumColumn[]): number[] {
  const sum = columns.reduce((acc, column) => acc + COLUMN_WEIGHT[column.id], 0) || 1;
  return columns.map((column) => (COLUMN_WEIGHT[column.id] / sum) * 100);
}

const known = (value: number | null | undefined): value is number => value !== null && value !== undefined;

/**
 * الأعمدة الافتراضية عند غياب أعمدة محفوظة في المراجعة: ما يعرضه المرجع البصري
 * (م · الصنف · الوحدة · الكمية · السعر · الخصم · الخاضع · النسبة · الضريبة · الإجمالي)
 * مع إسقاط ما لا يملك المصدر قيمته لأي سطر — لا عمود فارغ بالكامل ولا قيمة مختلَقة.
 */
export function premiumDefaultColumns(lines: readonly DocumentLine[]): PremiumColumn[] {
  const has = (predicate: (line: DocumentLine) => boolean) => lines.some(predicate);
  const columns: PremiumColumn[] = [
    { id: 'number' },
    { id: 'product' },
  ];
  if (has((line) => !!line.unit?.trim())) columns.push({ id: 'unit' });
  columns.push({ id: 'quantity' });
  columns.push(
    has((line) => known(line.priceBeforeTax))
      ? { id: 'price_before_tax', label: PREMIUM_COLUMN_LABELS.unit_price }
      : { id: 'unit_price' },
  );
  if (has((line) => known(line.lineDiscount))) columns.push({ id: 'line_discount' });
  if (has((line) => known(line.netAmount))) columns.push({ id: 'line_net' });
  if (has((line) => known(line.taxRate))) columns.push({ id: 'tax_rate' });
  columns.push({ id: 'tax' }, { id: 'total' });
  return columns;
}

export type PremiumTotalsRow =
  | { key: 'subtotal' | 'discount' | 'shipping' | 'adjustment' | 'vat'; amount: number }
  | { key: 'taxable'; amount: number };

/**
 * صفوف الإجماليات كما تصل من المصدر. «الإجمالي الخاضع» صفٌّ مشتق (المجموع − الخصم) لا مخزَّن، فلا يُعرض
 * إلا لخصمٍ موجب ومع ثبوت المطابقة بالهللة للإجمالي المخزَّن بلا شحن أو تسوية:
 * `المجموع − الخصم + الضريبة = الإجمالي`. غير ذلك يُحذف الصف (لا اختلاق ولا إعادة حساب).
 */
export function premiumTotalsRows(model: DocumentModel): PremiumTotalsRow[] {
  const { totals } = model;
  const rows: PremiumTotalsRow[] = [{ key: 'subtotal', amount: totals.subtotal }];
  const discount = totals.discount ?? 0;
  const shipping = totals.shipping ?? 0;
  const adjustment = totals.adjustment ?? 0;
  if (discount > 0) {
    rows.push({ key: 'discount', amount: discount });
    const taxable = totals.subtotal - discount;
    if (shipping === 0 && adjustment === 0 && taxable + totals.tax === totals.total) {
      rows.push({ key: 'taxable', amount: taxable });
    }
  }
  if (shipping > 0) rows.push({ key: 'shipping', amount: shipping });
  if (adjustment !== 0) rows.push({ key: 'adjustment', amount: adjustment });
  rows.push({ key: 'vat', amount: totals.tax });
  return rows;
}

export interface PremiumMetaTile {
  key: 'invoice_no' | 'issue_date' | 'due_date' | 'payment';
  /** القيمة المعروضة؛ طريقة الدفع تحمل مفتاح التسمية لتُترجم بوضع المستند. */
  value: string;
  valueLabel?: PremiumLabelKey;
}

/** بطاقات الميتا: لا بطاقة بلا قيمة في المصدر (تاريخ التوريد غير موجود في `DocumentMeta` فلا يُختلق). */
export function premiumMetaTiles(model: DocumentModel): PremiumMetaTile[] {
  const { meta } = model;
  const tiles: PremiumMetaTile[] = [
    { key: 'invoice_no', value: meta.number },
    { key: 'issue_date', value: meta.date },
  ];
  if (meta.dueDate?.trim()) tiles.push({ key: 'due_date', value: meta.dueDate.trim() });
  if (meta.paymentType === 'cash') tiles.push({ key: 'payment', value: '', valueLabel: 'cash' });
  else if (meta.paymentType === 'credit') tiles.push({ key: 'payment', value: '', valueLabel: 'credit' });
  return tiles;
}
