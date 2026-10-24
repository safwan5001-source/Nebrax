/**
 * عقد استيراد أعداد ورقة جرد (IMP-H7-S1c) كما يعرضه الخادم (`/stocktakes/count-import/*`). الجرد المستهدف خيارٌ مجمَّد للتشغيلة يأتي من مسار الصفحة لا من الملف.
 * الاستيراد **يكتب العدّ فقط** (ذرّياً للورقة كلها)؛ ترحيل الفروق (حركات مخزون وقيد) فعلٌ منفصل لا يمرّ من هنا. القالب أعمى: بلا رصيد نظام.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type ExistingCountPolicy = 'error' | 'overwrite' | 'skip';
export type StocktakeRowAction = 'write' | 'unchanged' | 'skip' | 'overwrite' | 'error';

export const MAX_STOCKTAKE_IMPORT_BYTES = 5 * 1024 * 1024;
export const STOCKTAKE_IMPORT_ROW_LIMIT = 5000;
export const ACCEPTED_STOCKTAKE_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** أي واحد منها يكفي لتعريف الصنف؛ الاسم ليس معرّفاً. */
export const STOCKTAKE_PRODUCT_IDENTIFIERS = ['nebrax_id', 'sku', 'barcode'];

export interface StocktakeImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface StocktakeInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface StocktakeInspectResult {
  columns: StocktakeInspectedColumn[];
  total_rows: number;
  fields: StocktakeImportField[];
}

export interface StocktakePreviewRow {
  row: number;
  action: StocktakeRowAction;
  status: string;
  valid: boolean;
  sku: string | null;
  barcode: string | null;
  product_name: string | null;
  quantity: number | null;
  current_count: number | null;
  messages: string[];
}

export interface StocktakeImportPreview {
  binding?: ImportBinding;
  stocktake_id: string;
  stocktake_number: string;
  existing_count_policy: ExistingCountPolicy;
  total_rows: number;
  sheet_lines: number;
  to_write: number;
  unchanged_rows: number;
  skipped_rows: number;
  overwrite_rows: number;
  error_rows: number;
  uncounted_after: number;
  rows: StocktakePreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type StocktakeColumnMapping = Record<number, string | null>;

export interface StocktakeImportOptions {
  stocktakeId: string;
  existingCountPolicy: ExistingCountPolicy;
  mapping?: StocktakeColumnMapping;
}

export function stocktakeImportFormData(file: File, options: StocktakeImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('stocktake_id', options.stocktakeId);
  form.append('existing_count_policy', options.existingCountPolicy);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة لما أُرسل إلى المعاينة كي تتطابق بصمتها. */
export function stocktakeJobOptions(options: StocktakeImportOptions): Record<string, string | Record<number, string | null>> {
  return {
    stocktake_id: options.stocktakeId,
    existing_count_policy: options.existingCountPolicy,
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedStocktakeMapping(columns: StocktakeInspectedColumn[]): StocktakeColumnMapping {
  const mapping: StocktakeColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً. */
export function stocktakeMappingGaps(mapping: StocktakeColumnMapping): { missingIdentifier: boolean; missingQuantity: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingIdentifier: !STOCKTAKE_PRODUCT_IDENTIFIERS.some((key) => counts.has(key)),
    missingQuantity: !counts.has('counted_quantity'),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function stocktakeFieldLabel(field: StocktakeImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
