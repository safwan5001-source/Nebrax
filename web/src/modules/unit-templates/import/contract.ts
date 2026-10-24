/**
 * عقد استيراد قوالب الوحدات (IMP-H4-S6c) كما يعرضه الخادم (`/unit-templates/import/*`). الصف **وحدة بديلة واحدة** داخل قالب (صيغة طويلة): صفوف القالب الواحد تتشارك
 * اسمه ووحدة أساسه، وقالبٌ بلا وحدات بديلة صفٌّ واحد بلا وحدة. **إنشاء فقط**: لا تعديل لقالب قائم ولا إضافة وحدات إليه ولا ربط بالمنتجات (المعامل يضرب الكمية الداخلة
 * إلى المخزون). مجالٌ ذرّي: الملف كله في معاملة واحدة، فلا قطع ولا تقدّم صفوف ولا إصلاح صفوف، وفشله لا يكتب شيئاً. لا apply متزامن: التنفيذ تشغيلةٌ مربوطةٌ بمعاينتها.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

/** سياسة قالبٍ موجودٍ بالاسم نفسه: `error` يُفشل صفوفه، `skip` يتخطّاه كله. لا تحديث أبداً. */
export type UnitTemplateExistingPolicy = 'error' | 'skip';
export type UnitTemplateRowAction = 'create' | 'skip' | 'error';

export const MAX_UNIT_TEMPLATE_IMPORT_BYTES = 5 * 1024 * 1024;
export const UNIT_TEMPLATE_IMPORT_ROW_LIMIT = 2000;
export const ACCEPTED_UNIT_TEMPLATE_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const UNIT_TEMPLATE_EXISTING_POLICIES: UnitTemplateExistingPolicy[] = ['error', 'skip'];
export const DEFAULT_UNIT_TEMPLATE_EXISTING_POLICY: UnitTemplateExistingPolicy = 'error';

export interface UnitTemplateImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface UnitTemplateInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface UnitTemplateInspectResult {
  columns: UnitTemplateInspectedColumn[];
  total_rows: number;
  fields: UnitTemplateImportField[];
}

export interface UnitTemplatePreviewRow {
  row: number;
  action: UnitTemplateRowAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  template: string | null;
  base_unit: string | null;
  unit: string | null;
  factor: number | null;
  messages: string[];
  warnings: string[];
}

export interface UnitTemplateImportPreview {
  binding?: ImportBinding;
  existing_policy: UnitTemplateExistingPolicy;
  total_rows: number;
  template_count: number;
  create_templates: number;
  skipped_templates: number;
  create_units: number;
  warning_rows: number;
  error_rows: number;
  rows: UnitTemplatePreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type UnitTemplateColumnMapping = Record<number, string | null>;

export interface UnitTemplateImportOptions {
  existingPolicy: UnitTemplateExistingPolicy;
  mapping?: UnitTemplateColumnMapping;
}

export function unitTemplateImportFormData(file: File, options: UnitTemplateImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('existing_policy', options.existingPolicy);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة حرفياً لما أُرسل إلى المعاينة كي تتطابق بصمتها. */
export function unitTemplateJobOptions(options: UnitTemplateImportOptions): Record<string, string | Record<number, string | null>> {
  return {
    existing_policy: options.existingPolicy,
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedUnitTemplateMapping(columns: UnitTemplateInspectedColumn[]): UnitTemplateColumnMapping {
  const mapping: UnitTemplateColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/**
 * ما ينقص المطابقة قبل السماح بالمعاينة — يرفضه الخادم أيضاً: «اسم القالب» و«وحدة الأساس» إلزاميان، و«الوحدة البديلة» و«المعامل» يُربطان معاً أو يُتركان معاً
 * (وحدة بلا معامل أو العكس لا معنى لها)، ولا حقل يُربط بأكثر من عمود.
 */
export function unitTemplateMappingGaps(mapping: UnitTemplateColumnMapping): {
  missingName: boolean;
  missingBaseUnit: boolean;
  unpairedUnitFactor: boolean;
  duplicate: boolean;
} {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingName: !counts.has('template_name'),
    missingBaseUnit: !counts.has('base_unit'),
    unpairedUnitFactor: counts.has('unit_name') !== counts.has('factor'),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function unitTemplateFieldLabel(field: UnitTemplateImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
