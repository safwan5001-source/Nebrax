/**
 * عقد استيراد العملاء/الموردين (IMP-H3-S3) كما يعرضه الخادم (`/partners/import/*`). النوع (عميل/مورّد) يحدّده مدخل الشاشة لا الملف،
 * ولا رصيد افتتاحي هنا أبداً (D-01) — الخادم لا يقبل `opening_balance` أصلاً. لا apply متزامن: التنفيذ تشغيلةٌ دائمةٌ مربوطةٌ بمعاينتها.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type PartnerImportType = 'customer' | 'supplier';
export type PartnerImportMode = 'create' | 'update' | 'upsert';
export type PartnerBlankPolicy = 'ignore' | 'clear';
export type DuplicateSignalPolicy = 'warn' | 'skip' | 'error';
export type PartnerRowAction = 'create' | 'update' | 'skip' | 'error';

export const MAX_PARTNER_IMPORT_BYTES = 5 * 1024 * 1024;
export const PARTNER_IMPORT_ROW_LIMIT = 20000;
export const ACCEPTED_PARTNER_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PARTNER_IDENTIFIER_FIELDS = ['nebrax_id', 'code'];

export interface PartnerImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
  clearable: boolean;
  update_locked: boolean;
  writable: boolean;
}

export interface PartnerInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface PartnerInspectResult {
  columns: PartnerInspectedColumn[];
  total_rows: number;
  fields: PartnerImportField[];
}

export interface PartnerPreviewRow {
  row: number;
  action: PartnerRowAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  code: string | null;
  name: string | null;
  messages: string[];
  warnings: string[];
}

export interface PartnerImportPreview {
  /** معاينةٌ أحادية الاستعمال يحفظها الخادم — تُرفَق بإنشاء التشغيلة الدائمة. */
  binding?: ImportBinding;
  type: PartnerImportType;
  total_rows: number;
  create_rows: number;
  update_rows: number;
  skipped_rows: number;
  warning_rows: number;
  error_rows: number;
  rows: PartnerPreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type PartnerColumnMapping = Record<number, string | null>;

export interface PartnerImportOptions {
  type: PartnerImportType;
  mode: PartnerImportMode;
  blankPolicy: PartnerBlankPolicy;
  duplicateSignalPolicy: DuplicateSignalPolicy;
  /** تُرسَل فقط حين تتوفر نتيجة فحص — وإلا يطابق الخادم تلقائياً بالاسم. */
  mapping?: PartnerColumnMapping;
}

export function partnerImportFormData(file: File, options: PartnerImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('type', options.type);
  form.append('mode', options.mode);
  form.append('blank_policy', options.blankPolicy);
  form.append('duplicate_signal_policy', options.duplicateSignalPolicy);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة حرفياً لما أُرسل إلى المعاينة كي تتطابق بصمتها. */
export function partnerJobOptions(options: PartnerImportOptions): Record<string, string | Record<number, string | null>> {
  return {
    type: options.type,
    mode: options.mode,
    blank_policy: options.blankPolicy,
    duplicate_signal_policy: options.duplicateSignalPolicy,
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedPartnerMapping(columns: PartnerInspectedColumn[]): PartnerColumnMapping {
  const mapping: PartnerColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً. */
export function partnerMappingGaps(
  mapping: PartnerColumnMapping,
  fields: PartnerImportField[],
  mode: PartnerImportMode
): { missingRequired: PartnerImportField[]; missingIdentifier: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  const needsRequired = mode === 'create' || mode === 'upsert';
  const needsIdentifier = mode === 'update' || mode === 'upsert';

  return {
    missingRequired: needsRequired ? fields.filter((field) => field.required && !counts.has(field.key)) : [],
    missingIdentifier: needsIdentifier && !PARTNER_IDENTIFIER_FIELDS.some((key) => counts.has(key)),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function partnerFieldLabel(field: PartnerImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
