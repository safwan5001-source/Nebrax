/**
 * عقد استيراد أسعار قائمة سعر (IMP-H4-S6b) كما يعرضه الخادم (`/price-lists/import/*`). القائمة المستهدفة **خيارٌ إلزامي مجمَّد للتشغيلة** تُختار في الشاشة لا في الملف.
 * صفٌّ = سعر منتجٍ ووحدةٍ داخل تلك القائمة؛ هوية الصف معرّف نبراكس أو رمز الصنف (الاسم ليس معرّفاً)، ووحدة الصف الفارغة = وحدة أساس المنتج. لا أثر على بطاقة المنتج
 * ولا على سعر فاتورة محفوظة ولا على المحاسبة. لا apply متزامن: التنفيذ تشغيلةٌ دائمةٌ مربوطةٌ بمعاينتها. المبالغ المعروضة من الخادم بالهللات وتُحوَّل عند العرض فقط.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type PriceListImportMode = 'create' | 'update' | 'upsert';
export type PriceListImportRowAction = 'create' | 'update' | 'skip' | 'error';

export const MAX_PRICE_LIST_IMPORT_BYTES = 5 * 1024 * 1024;
export const PRICE_LIST_IMPORT_ROW_LIMIT = 20000;
export const ACCEPTED_PRICE_LIST_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PRICE_LIST_IMPORT_MODES: PriceListImportMode[] = ['upsert', 'create', 'update'];
/** سلوك المصنّف والخادم الافتراضي: يحدّث السعر القائم وينشئ الناقص. */
export const DEFAULT_PRICE_LIST_IMPORT_MODE: PriceListImportMode = 'upsert';

export interface PriceListImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface PriceListImportInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface PriceListImportInspectResult {
  columns: PriceListImportInspectedColumn[];
  total_rows: number;
  fields: PriceListImportField[];
}

export interface PriceListImportPreviewRow {
  row: number;
  action: PriceListImportRowAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  sku: string | null;
  product_name: string | null;
  /** الوحدة كما ستُخزَّن (فارغة/`null` = وحدة الأساس). */
  unit: string | null;
  /** السعر الجديد بالهللات، أو `null` لصفّ غير صالح. */
  price: number | null;
  /** السعر القائم في القائمة بالهللات، أو `null` إن لم يوجد. */
  current_price: number | null;
  messages: string[];
  warnings: string[];
}

export interface PriceListImportPreview {
  binding?: ImportBinding;
  price_list_id: string;
  price_list_name: string;
  mode: PriceListImportMode;
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skipped_rows: number;
  warning_rows: number;
  error_rows: number;
  rows: PriceListImportPreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type PriceListImportColumnMapping = Record<number, string | null>;

export interface PriceListImportOptions {
  priceListId: string;
  mode: PriceListImportMode;
  mapping?: PriceListImportColumnMapping;
}

export function priceListImportFormData(file: File, options: PriceListImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('price_list_id', options.priceListId);
  form.append('mode', options.mode);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة حرفياً لما أُرسل إلى المعاينة كي تتطابق بصمتها. */
export function priceListJobOptions(options: PriceListImportOptions): Record<string, string | Record<number, string | null>> {
  return {
    price_list_id: options.priceListId,
    mode: options.mode,
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedPriceListMapping(columns: PriceListImportInspectedColumn[]): PriceListImportColumnMapping {
  const mapping: PriceListImportColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** ما ينقص المطابقة قبل السماح بالمعاينة — يرفضه الخادم أيضاً: «السعر» إلزامي، ويلزم معرّف منتج (معرّف نبراكس أو رمز الصنف) لا الاسم. */
export function priceListMappingGaps(mapping: PriceListImportColumnMapping): {
  missingPrice: boolean;
  missingIdentifier: boolean;
  duplicate: boolean;
} {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingPrice: !counts.has('price'),
    missingIdentifier: !counts.has('nebrax_id') && !counts.has('sku'),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function priceListFieldLabel(field: PriceListImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
