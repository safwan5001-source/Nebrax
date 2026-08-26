/**
 * عقد استيراد/تصدير المنتجات كما يعرضه الخادم — نوعٌ واحد تستهلكه الشاشة
 * والاختبارات معاً، فلا تنحرف الواجهة عن مفاتيح `ProductImportFields`.
 */

export type ImportMode = 'create' | 'update' | 'upsert';
export type BlankPolicy = 'ignore' | 'clear';
export type MasterDataPolicy = 'match_or_error' | 'match_or_text' | 'create_missing';
export type RowAction = 'create' | 'update' | 'skip' | 'error';
export type RowStatus = 'ok' | 'warning' | 'error';

export type ExportScope = 'selected' | 'filtered' | 'all';
export type ExportFormat = 'csv' | 'xlsx';
export type ExportTemplate = 'catalog' | 'round_trip';

export interface ImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
  clearable: boolean;
  update_locked: boolean;
  writable: boolean;
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
  truncated: boolean;
  fields: ImportField[];
}

export interface PreviewRow {
  row: number;
  action: RowAction;
  status: RowStatus;
  valid: boolean;
  sku: string | null;
  name: string | null;
  type: string | null;
  barcode: string | null;
  messages: string[];
}

export interface PreviewError {
  row: number;
  messages: string[];
}

export interface ImportPreview {
  mode: ImportMode;
  blank_policy: BlankPolicy;
  master_data_policy: MasterDataPolicy;
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skipped_rows: number;
  warning_rows: number;
  error_rows: number;
  rows: PreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: PreviewError[];
}

export interface ImportResult {
  mode: ImportMode;
  created: number;
  updated: number;
  skipped: number;
  total_rows: number;
  results: PreviewRow[];
}

/** فهرس العمود في الملف ← مفتاح حقل نبراكس، أو `null` لتجاهل العمود. */
export type ColumnMapping = Record<number, string | null>;

export const IMPORT_MODES: ImportMode[] = ['create', 'update', 'upsert'];
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** الحقول التي تصلح معرّفاً للتحديث؛ الاسم ليس منها ولن يكون. */
export const IDENTIFIER_FIELDS = ['nebrax_id', 'sku'];

export function fieldLabel(field: ImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** يبني `FormData` لمسارات الاستيراد — نقطة واحدة تمنع انحراف أسماء المعاملات. */
export function importFormData(
  file: File,
  options: {
    mode?: ImportMode;
    blankPolicy?: BlankPolicy;
    masterDataPolicy?: MasterDataPolicy;
    mapping?: ColumnMapping;
  } = {}
): FormData {
  const form = new FormData();
  form.append('file', file);
  if (options.mode) form.append('mode', options.mode);
  if (options.blankPolicy) form.append('blank_policy', options.blankPolicy);
  if (options.masterDataPolicy) form.append('master_data_policy', options.masterDataPolicy);

  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل صراحةً `ignore` كي لا تعود المطابقة التلقائية
      // فتربط عموداً قرّر المستخدم تجاهله.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }

  return form;
}

/**
 * ما ينقص المطابقة قبل السماح بالفحص — تُحسب في الواجهة لتعطي رسالة فورية،
 * ويظل الخادم هو من يرفض فعلياً (`assertMappingCoversContract`).
 */
export function mappingGaps(
  mapping: ColumnMapping,
  fields: ImportField[],
  mode: ImportMode
): { missingRequired: ImportField[]; missingIdentifier: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  const needsRequired = mode === 'create' || mode === 'upsert';
  const needsIdentifier = mode === 'update' || mode === 'upsert';

  return {
    missingRequired: needsRequired
      ? fields.filter((field) => field.required && !counts.has(field.key))
      : [],
    missingIdentifier: needsIdentifier && !IDENTIFIER_FIELDS.some((key) => counts.has(key)),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

/** يحوّل الاقتراح الخادميّ إلى حالة مطابقة قابلة للتحرير. */
export function suggestedMapping(columns: InspectedColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** صفوف تقرير قابل للتنزيل من نتيجة معاينة أو تطبيق. */
export function reportRows(rows: PreviewRow[]): (string | number | null)[][] {
  return rows.map((row) => [row.row, row.sku, row.name, row.action, row.status, row.messages.join(' — ')]);
}
