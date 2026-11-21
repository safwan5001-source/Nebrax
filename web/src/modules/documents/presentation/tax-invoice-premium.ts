/**
 * توكنز وتسميات قالب الفاتورة الضريبية الفاخرة `tax-invoice-premium-v1` فقط
 * (`composition: tax_invoice_premium`).
 *
 * عرض بحت: لا يُحفظ في المراجعة ولا يغيّر عقود التجميد أو الحساب. كل مبلغ يصل من `DocumentModel`
 * كما هو؛ الاشتقاق الوحيد هنا (صفّ «الإجمالي الخاضع») يُعرض فقط حين يثبت بالهللة أنه يطابق
 * الإجمالي المخزَّن (`المجموع − الخصم + الضريبة = الإجمالي`)، وإلا يُحذف الصف بدل اختلاقه.
 */

import type { DocItemsColumnId, DocumentLine, DocumentModel, DocumentTheme, ThemeId } from '../types';

/**
 * متغيّر التركيب: `full` الفاتورة الضريبية الكاملة (الافتراضي، لا يتغيّر مخرجه)، و`simplified` الفاتورة الضريبية المبسطة
 * (`tax-invoice-simplified-premium-v1`): بطاقة بائع مدمجة، عميل اختياري في شريط واحد، جدول بلا أعمدة خصم/خاضع افتراضياً، وبلا توقيعات.
 * فرق عرضي بحت: المبالغ والاشتقاقات الوحيدة المسموحة هي نفسها.
 */
export type PremiumVariant = 'full' | 'simplified';

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
    // نص ثانوي بتباين ≥ 4.5:1 على الأبيض لكل الثيمات (يحرسه اختبار) — التسميات الصغيرة يجب أن تُقرأ مطبوعةً.
    muted: mixHex(deep, '#ffffff', 0.22),
  };
}

export const PREMIUM = {
  logoMaxPx: 48,
  qrSizePx: 100,
  /** صفوف جدول البنود الدنيا — صفوف فارغة مرقّمة تكمل النموذج المطبوع كما في المرجع البصري. */
  minTableRows: 7,
} as const;

/** صفوف جدول المبسطة الدنيا: أقصر من الكاملة بلا توقيعات وبطاقة مشتري فتتسع صفحة A4 لصفوف مرقّمة أكثر كالمرجع. */
export const PREMIUM_SIMPLIFIED = { minTableRows: 8 } as const;

export const premiumMinRows = (variant: PremiumVariant) => (variant === 'simplified' ? PREMIUM_SIMPLIFIED.minTableRows : PREMIUM.minTableRows);

export type PremiumLabelPair = { ar: string; en: string };

export const PREMIUM_LABELS = {
  invoice_no: { ar: 'رقم الفاتورة', en: 'Invoice No.' },
  issue_date: { ar: 'تاريخ الإصدار', en: 'Issue date' },
  issue_time: { ar: 'الوقت', en: 'Time' },
  customer_optional: { ar: 'اسم العميل (اختياري)', en: 'Customer name (optional)' },
  total_excl_vat: { ar: 'الإجمالي قبل الضريبة', en: 'Total (excl. VAT)' },
  due_date: { ar: 'تاريخ الاستحقاق', en: 'Due date' },
  // نقدي/آجل = شروط السداد لا وسيلة الدفع؛ وسيلة الدفع الفعلية غير موجودة في `DocumentModel` فلا تُعرض.
  payment_terms: { ar: 'شروط السداد', en: 'Payment terms' },
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
  notes_terms: { ar: 'ملاحظات وشروط', en: 'Notes & terms' },
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
export function premiumDefaultColumns(lines: readonly DocumentLine[], variant: PremiumVariant = 'full'): PremiumColumn[] {
  const has = (predicate: (line: DocumentLine) => boolean) => lines.some(predicate);
  if (variant === 'simplified') return simplifiedColumns(lines);
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

/** نسبة الضريبة الموحَّدة المعلنة في كل الأسطر (`15`) أو `null` إن تعددت أو غابت لأي سطر — لا تُفترض. */
export function premiumUniformTaxRate(lines: readonly DocumentLine[]): number | null {
  if (lines.length === 0) return null;
  const first = lines[0].taxRate;
  if (!known(first)) return null;
  return lines.every((line) => line.taxRate === first) ? first : null;
}

/**
 * أعمدة المبسطة الافتراضية: م · الصنف · الوحدة · الكمية · السعر · (الخصم إن وُجد خصم موجب فتتطابق الأرقام) · الضريبة · الإجمالي شامل.
 * نسبة الضريبة تُكتب في عنوان عمود الضريبة حين تتوحد («ضريبة 15%»)، فإن تعددت المعلنة صار لها عمود، وغير المعلنة لا عمود لها.
 */
function simplifiedColumns(lines: readonly DocumentLine[]): PremiumColumn[] {
  const has = (predicate: (line: DocumentLine) => boolean) => lines.some(predicate);
  const columns: PremiumColumn[] = [{ id: 'number' }, { id: 'product' }];
  if (has((line) => !!line.unit?.trim())) columns.push({ id: 'unit' });
  columns.push({ id: 'quantity' });
  columns.push(has((line) => known(line.priceBeforeTax))
    ? { id: 'price_before_tax', label: PREMIUM_COLUMN_LABELS.unit_price }
    : { id: 'unit_price' });
  if (has((line) => (line.lineDiscount ?? 0) > 0)) columns.push({ id: 'line_discount' });
  if (new Set(lines.map((line) => line.taxRate).filter(known)).size > 1) columns.push({ id: 'tax_rate' });
  columns.push({ id: 'tax' }, { id: 'total' });
  return columns;
}

/**
 * تسميات أعمدة المبسطة حين لا تسمية محفوظة: «ضريبة 15%» لعمود الضريبة (نسبة موحَّدة معلنة) و«الإجمالي شامل / Total incl. VAT».
 * تغلبها دائماً التسمية التي حفظها صاحب القالب.
 */
export function premiumSimplifiedLabel(id: PremiumColumnId, lines: readonly DocumentLine[]): PremiumLabelPair | undefined {
  if (id === 'total') return { ar: 'الإجمالي شامل', en: 'Total incl. VAT' };
  if (id === 'tax') {
    const rate = premiumUniformTaxRate(lines);
    return rate === null ? undefined : { ar: `ضريبة ${rate}%`, en: `VAT ${rate}%` };
  }
  return undefined;
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
  key: 'invoice_no' | 'issue_date' | 'issue_time' | 'due_date' | 'payment_terms';
  /** القيمة المعروضة؛ طريقة الدفع تحمل مفتاح التسمية لتُترجم بوضع المستند. */
  value: string;
  valueLabel?: PremiumLabelKey;
}

/**
 * بطاقات الميتا — كل بطاقة تحمل المعنى الحقيقي لحقلها، ولا بطاقة بلا قيمة موثوقة:
 *  • تاريخ الإصدار = `meta.date` (تاريخ الفاتورة)، وتاريخ الاستحقاق = `meta.dueDate` — **ليس** تاريخ التوريد.
 *  • تاريخ التوريد غير موجود في `DocumentModel` ولا في عقد الفاتورة (الموجود تاريخ مذكرة التسليم فقط، وهو غيره)، فلا يُعرض ولا يُختلق.
 *  • نقدي/آجل = شروط السداد (`meta.paymentType`) لا وسيلة الدفع؛ وسيلة الدفع لا مصدر لها فلا تُعرض.
 */
export function premiumMetaTiles(model: DocumentModel, variant: PremiumVariant = 'full'): PremiumMetaTile[] {
  const { meta } = model;
  const tiles: PremiumMetaTile[] = [
    { key: 'invoice_no', value: meta.number },
    { key: 'issue_date', value: meta.date },
  ];
  // الوقت للمبسطة فقط وحين يوفّره المصدر (لحظة الإصدار المخزَّنة)؛ لا يُشتق ولا يُفترض.
  if (variant === 'simplified' && meta.time?.trim()) tiles.push({ key: 'issue_time', value: meta.time.trim() });
  if (meta.dueDate?.trim()) tiles.push({ key: 'due_date', value: meta.dueDate.trim() });
  if (meta.paymentType === 'cash') tiles.push({ key: 'payment_terms', value: '', valueLabel: 'cash' });
  else if (meta.paymentType === 'credit') tiles.push({ key: 'payment_terms', value: '', valueLabel: 'credit' });
  return tiles;
}


/**
 * أعمدة الاستوديو الافتراضية لهذا القالب (معرّفات المحرك فقط): ما يستطيع عقد الأعمدة القائم تمثيله من الأعمدة العشرة.
 * الوحدة والخصم والخاضع ونسبة الضريبة أعمدة يملكها القالب (يشتقها من بيانات السطر) ولا يعرفها عقد المحرر؛ تبقى ظاهرة دائماً.
 * `product_code` غير مفعّل هنا عمداً: رمز المنتج خيار يُفعَّل من الاستوديو ولا يظهر افتراضياً.
 */
export const PREMIUM_STUDIO_DEFAULT_COLUMNS = ['number', 'product', 'description', 'quantity', 'price_before_tax', 'tax', 'total'] as const satisfies readonly DocItemsColumnId[];

export interface PremiumSavedColumn {
  id: DocItemsColumnId;
  label?: string;
  alignment?: 'start' | 'center' | 'end';
}

export interface ResolvedPremiumColumns {
  columns: (PremiumColumn & { alignment?: 'start' | 'center' | 'end' })[];
  /** رمز المنتج يُعرض تحت اسم الصنف (لا عموداً مستقلاً). */
  skuInName: boolean;
}

const PRICE_IDS: readonly PremiumColumnId[] = ['price_before_tax', 'unit_price'];

/**
 * يحسم أعمدة الجدول:
 *  • بلا أعمدة محفوظة: الأعمدة العشرة المشتقة من البيانات، ورمز المنتج مخفي (المظهر الافتراضي).
 *  • بأعمدة محفوظة من الاستوديو: ترتيبها وتسمياتها ومحاذاتها كما حُفظت، **مع إبقاء الأعمدة الأربعة التي يملكها القالب**
 *    (الوحدة، الخصم، الخاضع، نسبة الضريبة) متى وُجدت بياناتها — فلا يُسقطها حفظ قائمة المحرر (لا يعرفها عقد الأعمدة).
 *  • `description` المحفوظ مع `product` يُطوى في خانة الصنف (سطر ثانوي)، لأن العقد يُلزم بالوصف.
 *  • `product_code` المحفوظ = «أظهر رمز المنتج تحت الاسم»: لا يصير عموداً. إن لم يوجد عمود اسم/وصف يحمله يبقى عموداً مستقلاً
 *    بدل أن يضيع.
 */
export function premiumResolveColumns(lines: readonly DocumentLine[], saved?: readonly PremiumSavedColumn[] | null, variant: PremiumVariant = 'full'): ResolvedPremiumColumns {
  if (!saved) return { columns: withSimplifiedLabels(premiumDefaultColumns(lines, variant), lines, variant), skuInName: false };

  const savedIds = new Set(saved.map((column) => column.id));
  // عقد الاستوديو يُلزم عمود «الوصف» دائماً (`description` + `total` إلزاميان)، وخانة الصنف في هذا القالب تحمل الوصف أصلاً كسطر ثانوي؛
  // فحين يوجد `product` يُطوى `description` فيه بدل عمود مكرر (لا يضيع الوصف ولا تتضاعف الأعمدة).
  const foldDescription = savedIds.has('product') && savedIds.has('description');
  const base: (PremiumColumn & { alignment?: 'start' | 'center' | 'end' })[] = saved
    .filter((column) => !(foldDescription && column.id === 'description'))
    .map((column) => ({
      id: column.id,
      alignment: column.alignment,
      label: column.label?.trim() ? { ar: column.label.trim(), en: column.label.trim() } : undefined,
    }));
  const hasId = (id: PremiumColumnId) => base.some((column) => column.id === id);
  const host = hasId('product') || hasId('description');
  const skuRequested = hasId('product_code');
  const skuInName = skuRequested && host;
  const columns = skuInName ? base.filter((column) => column.id !== 'product_code') : base;

  if (variant === 'simplified') {
    // المبسطة: لا يُحقن «الخاضع/النسبة» تلقائياً؛ الوحدة قبل الكمية، والخصم فقط إن وُجد خصم موجب (لتتطابق الأرقام).
    const unitAt = columns.findIndex((column) => column.id === 'quantity');
    const withUnit = !hasId('unit') && lines.some((line) => !!line.unit?.trim());
    if (withUnit) columns.splice(unitAt >= 0 ? unitAt : columns.length, 0, { id: 'unit' });
    if (!hasId('line_discount') && lines.some((line) => (line.lineDiscount ?? 0) > 0)) {
      const price = Math.max(...PRICE_IDS.map((id) => columns.findIndex((column) => column.id === id)));
      columns.splice(price >= 0 ? price + 1 : columns.length, 0, { id: 'line_discount' });
    }
    // نسب ضريبة متعددة: عنوان الضريبة لا يحمل نسبة، فيبقى عمود النسبة (كمسار غير المحفوظ) كي لا يُسقطها تعديل استوديو لا علاقة له (مثل تفعيل رمز المنتج).
    if (!hasId('tax_rate') && new Set(lines.map((line) => line.taxRate).filter(known)).size > 1) {
      const tax = columns.findIndex((column) => column.id === 'tax');
      const total = columns.findIndex((column) => column.id === 'total');
      columns.splice(tax >= 0 ? tax : total >= 0 ? total : columns.length, 0, { id: 'tax_rate' });
    }
    return { columns: withSimplifiedLabels(columns, lines, variant), skuInName };
  }

  const has = (predicate: (line: DocumentLine) => boolean) => lines.some(predicate);
  const insertAt = (column: PremiumColumn, index: number) => { columns.splice(Math.max(0, Math.min(index, columns.length)), 0, column); };
  const indexOf = (id: PremiumColumnId) => columns.findIndex((column) => column.id === id);
  const afterNameIndex = () => {
    const last = Math.max(indexOf('product'), indexOf('description'), indexOf('barcode'), indexOf('number'));
    return last + 1;
  };

  // الوحدة قبل الكمية (وإلا بعد الاسم).
  if (!hasId('unit') && has((line) => !!line.unit?.trim())) insertAt({ id: 'unit' }, indexOf('quantity') >= 0 ? indexOf('quantity') : afterNameIndex());
  // الخصم والخاضع والنسبة بعد عمود السعر (وإلا قبل الضريبة/الإجمالي).
  const detail: PremiumColumn[] = [];
  if (!hasId('line_discount') && has((line) => known(line.lineDiscount))) detail.push({ id: 'line_discount' });
  if (!hasId('line_net') && has((line) => known(line.netAmount))) detail.push({ id: 'line_net' });
  if (!hasId('tax_rate') && has((line) => known(line.taxRate))) detail.push({ id: 'tax_rate' });
  if (detail.length > 0) {
    const priceIdx = Math.max(...PRICE_IDS.map((id) => indexOf(id)));
    const anchor = priceIdx >= 0 ? priceIdx + 1 : (indexOf('tax') >= 0 ? indexOf('tax') : (indexOf('total') >= 0 ? indexOf('total') : columns.length));
    detail.forEach((column, i) => insertAt(column, anchor + i));
  }
  return { columns, skuInName };
}

function withSimplifiedLabels<T extends PremiumColumn>(columns: T[], lines: readonly DocumentLine[], variant: PremiumVariant): T[] {
  if (variant !== 'simplified') return columns;
  return columns.map((column) => (column.label ? column : { ...column, label: premiumSimplifiedLabel(column.id, lines) }));
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * سطر رمز المنتج تحت الاسم: الرمز المخزَّن في السطر (`productCode`) فقط، مقصوصاً.
 * يُحجب (`null`) إن كان فارغاً، أو مطابقاً للاسم، أو مذكوراً أصلاً في اسم الصنف/وصفه كرمز مستقل
 * (مطابقة بحدود الأحرف والأرقام وبلا حساسية لحالة الأحرف: «POT-004» داخل «Potato POT-004» مكرر، و«1» داخل «10 كجم» ليس كذلك).
 */
export function premiumSkuLine(line: Pick<DocumentLine, 'productCode' | 'productName' | 'description'>): string | null {
  const code = line.productCode?.trim();
  if (!code) return null;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(code)}($|[^\\p{L}\\p{N}])`, 'iu');
  for (const text of [line.productName, line.description]) {
    const value = text?.trim();
    if (value && (value.toLowerCase() === code.toLowerCase() || pattern.test(value))) return null;
  }
  return code;
}
