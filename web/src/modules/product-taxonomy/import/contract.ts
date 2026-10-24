/**
 * عقد استيراد تصنيفات المنتجات وعلاماتها التجارية (IMP-H4-S6a) كما يعرضه الخادم (`/product-taxonomy/import/*`). النوع (تصنيف/علامة) يحدّده مدخل الشاشة لا الملف.
 * صفٌّ = عنصر واحد؛ هوية التصنيف **مساره** (الأب + الاسم) وهوية العلامة اسمها، ومعرّف نبراكس يتقدّم متى وُجد. لا إعادة تسمية ولا نقل لعنصر قائم، ولا ربط بالمنتجات،
 * ولا أثر محاسبي أو مخزني. لا apply متزامن: التنفيذ تشغيلةٌ دائمةٌ مربوطةٌ بمعاينتها.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type TaxonomyKind = 'category' | 'brand';
export type TaxonomyMode = 'create' | 'update' | 'upsert';
export type TaxonomyBlankPolicy = 'ignore' | 'clear';
export type TaxonomyParentPolicy = 'error' | 'create_missing';
export type TaxonomyRowAction = 'create' | 'update' | 'skip' | 'error';

export const MAX_TAXONOMY_IMPORT_BYTES = 5 * 1024 * 1024;
export const TAXONOMY_IMPORT_ROW_LIMIT = 20000;
export const ACCEPTED_TAXONOMY_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TAXONOMY_MODES: TaxonomyMode[] = ['create', 'update', 'upsert'];

export interface TaxonomyField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
  clearable: boolean;
  writable: boolean;
}

export interface TaxonomyInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface TaxonomyInspectResult {
  columns: TaxonomyInspectedColumn[];
  total_rows: number;
  fields: TaxonomyField[];
}

export interface TaxonomyPreviewRow {
  row: number;
  action: TaxonomyRowAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  name: string | null;
  /** مسار التصنيف الكامل (للتصنيفات فقط). */
  path: string | null;
  creates_parents: string[];
  messages: string[];
  warnings: string[];
}

export interface TaxonomyImportPreview {
  binding?: ImportBinding;
  kind: TaxonomyKind;
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skipped_rows: number;
  warning_rows: number;
  error_rows: number;
  implicit_parents: number;
  rows: TaxonomyPreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type TaxonomyColumnMapping = Record<number, string | null>;

export interface TaxonomyImportOptions {
  kind: TaxonomyKind;
  mode: TaxonomyMode;
  blankPolicy: TaxonomyBlankPolicy;
  /** للتصنيفات فقط؛ العلامات لا أب لها فلا تُرسَل. */
  parentPolicy: TaxonomyParentPolicy;
  mapping?: TaxonomyColumnMapping;
}

export const DEFAULT_TAXONOMY_IMPORT_OPTIONS = { mode: 'create', blankPolicy: 'ignore', parentPolicy: 'error' } as const;

export function taxonomyImportFormData(file: File, options: TaxonomyImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', options.kind);
  form.append('mode', options.mode);
  form.append('blank_policy', options.blankPolicy);
  if (options.kind === 'category') form.append('parent_policy', options.parentPolicy);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة حرفياً لما أُرسل إلى المعاينة كي تتطابق بصمتها. */
export function taxonomyJobOptions(options: TaxonomyImportOptions): Record<string, string | Record<number, string | null>> {
  return {
    kind: options.kind,
    mode: options.mode,
    blank_policy: options.blankPolicy,
    ...(options.kind === 'category' ? { parent_policy: options.parentPolicy } : {}),
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedTaxonomyMapping(columns: TaxonomyInspectedColumn[]): TaxonomyColumnMapping {
  const mapping: TaxonomyColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/**
 * ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً: الإنشاء/الإدراج يحتاجان «الاسم»، والتحديث يكفيه «الاسم» أو «معرّف نبراكس».
 */
export function taxonomyMappingGaps(
  mapping: TaxonomyColumnMapping,
  mode: TaxonomyMode
): { missingName: boolean; missingIdentifier: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingName: (mode === 'create' || mode === 'upsert') && !counts.has('name'),
    missingIdentifier: mode === 'update' && !counts.has('name') && !counts.has('nebrax_id'),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function taxonomyFieldLabel(field: TaxonomyField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
