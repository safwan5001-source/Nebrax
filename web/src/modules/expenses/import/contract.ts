/**
 * عقد استيراد المصروفات (IMP-H5-S2b) كما يعرضه الخادم (`/expenses/import/*`). صفٌّ = **مسودة** مصروف؛ لا ترحيل ولا قيد من هذه الشاشة، والضريبة والإجمالي
 * يشتقّهما الخادم. لا apply متزامن: التنفيذ تشغيلةٌ دائمةٌ مربوطةٌ بمعاينتها. التكرار الحقيقي يؤكّده المستخدم صراحةً بأرقام صفوف الورقة.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type ExpenseReferencePolicy = 'optional' | 'required';
export type ExpensePaymentMethod = 'cash' | 'bank' | 'credit';
export type ExpenseRowAction = 'create' | 'error';

export const MAX_EXPENSE_IMPORT_BYTES = 5 * 1024 * 1024;
export const EXPENSE_IMPORT_ROW_LIMIT = 20000;
export const ACCEPTED_EXPENSE_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXPENSE_PAYMENT_METHODS: ExpensePaymentMethod[] = ['cash', 'bank', 'credit'];

export interface ExpenseImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface ExpenseInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface ExpenseInspectResult {
  columns: ExpenseInspectedColumn[];
  total_rows: number;
  fields: ExpenseImportField[];
}

export interface ExpensePreviewRow {
  row: number;
  action: ExpenseRowAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  date: string | null;
  amount_minor: number | null;
  account_code: string | null;
  vendor: string | null;
  reference: string | null;
  confirmed_repeat: boolean;
  /** صفٌّ رُفض لأنه يطابق مصروفاً آخر — يُعرض له خيار «تكرار حقيقي». */
  repeat_candidate: boolean;
  messages: string[];
  warnings: string[];
}

export interface ExpenseImportPreview {
  binding?: ImportBinding;
  total_rows: number;
  create_rows: number;
  warning_rows: number;
  error_rows: number;
  create_amount_minor: number;
  confirmed_repeat_rows: number[];
  rows: ExpensePreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type ExpenseColumnMapping = Record<number, string | null>;

export interface ExpenseImportOptions {
  referencePolicy: ExpenseReferencePolicy;
  /** معرّف حساب مصروف افتراضي لصفوف بلا كود حساب؛ فارغ = لا افتراضي. */
  defaultAccountId: string;
  defaultPaymentMethod: ExpensePaymentMethod;
  defaultTaxRate: number;
  /** أرقام صفوف الورقة التي أكّد المستخدم أنها تكرارٌ حقيقي. */
  confirmedRepeatRows: number[];
  mapping?: ExpenseColumnMapping;
}

export const DEFAULT_EXPENSE_IMPORT_OPTIONS: ExpenseImportOptions = {
  referencePolicy: 'optional',
  defaultAccountId: '',
  defaultPaymentMethod: 'cash',
  defaultTaxRate: 15,
  confirmedRepeatRows: [],
};

function sortedRows(rows: number[]): number[] {
  return [...new Set(rows)].sort((a, b) => a - b);
}

export function expenseImportFormData(file: File, options: ExpenseImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('reference_policy', options.referencePolicy);
  if (options.defaultAccountId) form.append('default_account_id', options.defaultAccountId);
  form.append('default_payment_method', options.defaultPaymentMethod);
  form.append('default_tax_rate', String(options.defaultTaxRate));
  sortedRows(options.confirmedRepeatRows).forEach((row) => form.append('confirmed_repeat_rows[]', String(row)));
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة لما أُرسل إلى المعاينة كي تتطابق بصمتها (الخادم يقارنها قانونياً). */
export function expenseJobOptions(options: ExpenseImportOptions): Record<string, string | number | number[] | Record<number, string | null>> {
  return {
    reference_policy: options.referencePolicy,
    ...(options.defaultAccountId ? { default_account_id: options.defaultAccountId } : {}),
    default_payment_method: options.defaultPaymentMethod,
    default_tax_rate: options.defaultTaxRate,
    ...(options.confirmedRepeatRows.length > 0 ? { confirmed_repeat_rows: sortedRows(options.confirmedRepeatRows) } : {}),
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedExpenseMapping(columns: ExpenseInspectedColumn[]): ExpenseColumnMapping {
  const mapping: ExpenseColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً. الحساب إما عمود كود أو حسابٌ افتراضي. */
export function expenseMappingGaps(
  mapping: ExpenseColumnMapping,
  fields: ExpenseImportField[],
  options: Pick<ExpenseImportOptions, 'defaultAccountId' | 'referencePolicy'>
): { missingRequired: ExpenseImportField[]; missingAccount: boolean; missingReference: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingRequired: fields.filter((field) => field.required && !counts.has(field.key)),
    missingAccount: !counts.has('account_code') && !options.defaultAccountId,
    missingReference: options.referencePolicy === 'required' && !counts.has('reference'),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

export function expenseFieldLabel(field: ExpenseImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** يضيف/يزيل صفاً من مجموعة التكرار المؤكَّد (قائمة مرتّبة بلا تكرار). */
export function toggleRepeatRow(rows: number[], row: number, confirmed: boolean): number[] {
  const next = new Set(rows);
  if (confirmed) next.add(row);
  else next.delete(row);
  return sortedRows([...next]);
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
