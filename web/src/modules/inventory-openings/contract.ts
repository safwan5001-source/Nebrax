/**
 * عقد استيراد الأرصدة الافتتاحية للمخزون كما يعرضه الخادم — نوعٌ واحد
 * تستهلكه الشاشة والاختبارات معاً، فلا تنحرف الواجهة عن `InventoryOpeningFields`.
 *
 * **منفصلٌ عمداً عن عقد استيراد المنتجات.** ذاك يضبط الكتالوج بلا أثر مخزني
 * ولا محاسبي، وهذا يفتتح الأرصدة فيحرّك المخزون ويولّد قيداً. خلطهما في عقدٍ
 * واحد كان يفتح باباً لتسرّب حقلٍ من أحدهما إلى الآخر.
 */

export type OpeningStatus = 'draft' | 'posted';
export type RowStatus = 'valid' | 'error';

export interface OpeningField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface InspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface InspectResult {
  columns: InspectedColumn[];
  total_rows: number;
  fields: OpeningField[];
}

/** مشكلة صفٍّ واحد: رمزٌ ثابت تُترجمه الواجهة، ونصٌّ عربي يسقط عليه. */
export interface RowIssue {
  code: string;
  field: string | null;
  value: string | null;
  message: string;
}

export interface PreviewRow {
  row: number;
  status: RowStatus;
  sku: string | null;
  barcode: string | null;
  product_name: string | null;
  warehouse: string | null;
  quantity: number | null;
  /** بالريال كنص — الخادم يحوّل من الهللات في طبقة العرض. */
  unit_cost: string | null;
  total_cost: string | null;
  notes: string | null;
  issues: RowIssue[];
}

export interface PreviewCounters {
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  duplicate_rows: number;
  products_not_found: number;
  warehouses_not_found: number;
  products_with_movements: number;
  total_quantity: number;
  total_value: string;
}

export interface PreviewResult {
  opening_date: string;
  allow_zero_cost: boolean;
  mapping: Record<number, string>;
  counters: PreviewCounters;
  rows: PreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; issues: RowIssue[] }[];
}

export interface OpeningLine {
  id: string;
  position: number;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  warehouse_id: string;
  warehouse_name?: string | null;
  branch_id?: string | null;
  quantity: number;
  unit_cost: string;
  total_cost: string;
  notes: string | null;
}

export interface OpeningDocument {
  id: string;
  number: string;
  opening_date: string;
  status: OpeningStatus;
  notes: string | null;
  source_filename: string | null;
  /** موافقة «تكلفة صفر» كما حُفظت على المستند — لا كما أُرسلت في الطلب. */
  allow_zero_cost: boolean;
  total_quantity: number;
  total_value: string;
  journal_entry_id: string | null;
  posted_at: string | null;
  lines_count?: number;
  lines?: OpeningLine[];
}

/** فهرس العمود في الملف ← مفتاح الحقل، أو `null` لتجاهل العمود. */
export type ColumnMapping = Record<number, string | null>;

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMPORT_TYPES =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** الحقول التي تصلح معرّفاً للصنف؛ الاسم ليس منها ولن يكون. */
export const PRODUCT_IDENTIFIERS = ['nebrax_id', 'sku', 'barcode'];
/** الحقول التي تصلح معرّفاً للمخزن. */
export const WAREHOUSE_IDENTIFIERS = ['warehouse_id', 'warehouse'];

/** العدّادات المعروضة في شاشة المعاينة، بترتيبها الثابت. */
export const COUNTER_KEYS = [
  'valid_rows',
  'error_rows',
  'duplicate_rows',
  'products_not_found',
  'warehouses_not_found',
  'products_with_movements',
] as const;

export function fieldLabel(field: OpeningField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** يبني `FormData` لمسارات الاستيراد — نقطة واحدة تمنع انحراف أسماء المعاملات. */
export function importFormData(
  file: File,
  options: {
    openingDate?: string;
    allowZeroCost?: boolean;
    notes?: string;
    mapping?: ColumnMapping;
  } = {}
): FormData {
  const form = new FormData();
  form.append('file', file);
  if (options.openingDate) form.append('opening_date', options.openingDate);
  if (options.allowZeroCost) form.append('allow_zero_cost', '1');
  if (options.notes) form.append('notes', options.notes);

  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل صراحةً `ignore` كي لا تعود المطابقة التلقائية
      // فتربط عموداً قرّر المستخدم تجاهله.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }

  return form;
}

/** يحوّل الاقتراح الخادميّ إلى حالة مطابقة قابلة للتحرير. */
export function suggestedMapping(columns: InspectedColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/**
 * ما ينقص المطابقة قبل السماح بالفحص — تُحسب في الواجهة لتعطي رسالة فورية،
 * ويظل الخادم هو من يرفض فعلياً (`assertMappingCoversContract`).
 */
export function mappingGaps(
  mapping: ColumnMapping,
  fields: OpeningField[]
): { missingRequired: OpeningField[]; missingProduct: boolean; missingWarehouse: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingRequired: fields.filter((field) => field.required && !counts.has(field.key)),
    missingProduct: !PRODUCT_IDENTIFIERS.some((key) => counts.has(key)),
    missingWarehouse: !WAREHOUSE_IDENTIFIERS.some((key) => counts.has(key)),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

/** جاهزية المطابقة للانتقال إلى الفحص. */
export function mappingReady(mapping: ColumnMapping, fields: OpeningField[]): boolean {
  const gaps = mappingGaps(mapping, fields);
  return (
    gaps.missingRequired.length === 0 && !gaps.missingProduct && !gaps.missingWarehouse && !gaps.duplicate
  );
}

/** صفوف تقرير أخطاء قابل للتنزيل من نتيجة المعاينة. */
export function issueReportRows(rows: PreviewRow[]): (string | number | null)[][] {
  return rows
    .filter((row) => row.status === 'error')
    .flatMap((row) =>
      row.issues.map((issue) => [row.row, row.sku, row.warehouse, issue.code, issue.field, issue.message])
    );
}
