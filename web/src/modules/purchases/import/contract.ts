/**
 * عقد استيراد فواتير المشتريات (IMP-H5-S4b) كما يعرضه الخادم (`/purchases/import/*`). **الوحدة فاتورة المورّد كلها** (صفوف الملف بنودها)؛ المخرج **مسودة** مشتريات
 * لكل فاتورة: لا ترحيل ولا قيد ولا حركة مخزون من هذه الشاشة، والإجماليات يشتقّها الخادم من السطور (عمود «إجمالي الفاتورة» للمطابقة فقط). لا apply متزامن: التنفيذ تشغيلةٌ
 * دائمةٌ مربوطةٌ بمعاينتها. التكرار (مورّد ‖ رقم فاتورته) يُرفض ولا تأكيد له.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type PurchasePaymentType = 'cash' | 'credit';
/** «افتراضي المؤسسة» = لا قيمة تُرسَل (الخادم يحسمها من تفضيلات المؤسسة ويجمّدها مع المعاينة). */
export type TriState = '' | 'yes' | 'no';
export type PurchaseUnitAction = 'create' | 'error';

export const MAX_PURCHASE_IMPORT_BYTES = 5 * 1024 * 1024;
export const PURCHASE_IMPORT_ROW_LIMIT = 20000;
export const ACCEPTED_PURCHASE_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PURCHASE_PAYMENT_TYPES: PurchasePaymentType[] = ['cash', 'credit'];
/** الحقول التي لا يُشترط ظهورها بعمود لأن لها بديلاً (المورّد الافتراضي)، ومجموعة تعريف المنتج (يكفي أحدها). */
export const PRODUCT_IDENTIFIER_FIELDS = ['product_id', 'sku', 'barcode'] as const;

export interface PurchaseImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface PurchaseInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface PurchaseInspectResult {
  columns: PurchaseInspectedColumn[];
  total_rows: number;
  fields: PurchaseImportField[];
}

export interface PurchasePreviewUnit {
  /** رقم أول صف في الورقة. */
  row: number;
  rows: number[];
  ordinal: number;
  action: PurchaseUnitAction;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  supplier_invoice_ref: string | null;
  supplier_code: string | null;
  date: string | null;
  lines: number;
  total_minor: number;
  existing_purchase: boolean;
  messages: string[];
  warnings: string[];
}

export interface PurchaseImportPreview {
  binding?: ImportBinding;
  /** القيم **الفعلية** التي ستُجمَّد على التشغيلة (تفضيلات المؤسسة محسومة) — تُعرض قبل التأكيد. */
  default_payment_type?: PurchasePaymentType | null;
  default_tax_rate?: number | null;
  tax_inclusive?: boolean | null;
  warehouse_id?: string | null;
  total_rows: number;
  total_units: number;
  create_units: number;
  warning_units: number;
  error_units: number;
  create_total_minor: number;
  units: PurchasePreviewUnit[];
  units_shown: number;
  units_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type PurchaseColumnMapping = Record<number, string | null>;

export interface PurchaseImportOptions {
  /** معرّف مورّد افتراضي للصفوف بلا كود مورّد؛ فارغ = لا افتراضي. */
  defaultSupplierId: string;
  /** فارغ = تفضيل المؤسسة. */
  defaultPaymentType: PurchasePaymentType | '';
  /** نسبة افتراضية للصفوف بلا نسبة؛ فارغ = تفضيل المؤسسة. */
  defaultTaxRate: number | null;
  /** هل أسعار الملف شاملة الضريبة؛ فارغ = تفضيل المؤسسة. */
  taxInclusive: TriState;
  /** مستودع اختياري يُسجَّل على المسودات؛ فارغ = بلا مستودع. */
  warehouseId: string;
  mapping?: PurchaseColumnMapping;
}

export const DEFAULT_PURCHASE_IMPORT_OPTIONS: PurchaseImportOptions = {
  defaultSupplierId: '',
  defaultPaymentType: '',
  defaultTaxRate: null,
  taxInclusive: '',
  warehouseId: '',
};

export function purchaseImportFormData(file: File, options: PurchaseImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  if (options.defaultSupplierId) form.append('default_supplier_id', options.defaultSupplierId);
  if (options.defaultPaymentType) form.append('default_payment_type', options.defaultPaymentType);
  if (options.defaultTaxRate !== null) form.append('default_tax_rate', String(options.defaultTaxRate));
  if (options.taxInclusive) form.append('tax_inclusive', options.taxInclusive === 'yes' ? '1' : '0');
  if (options.warehouseId) form.append('warehouse_id', options.warehouseId);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/** خيارات التشغيلة الدائمة (`options[...]`) — مطابقة لما أُرسل إلى المعاينة كي تتطابق بصمتها (الخادم يحسم الغائب من تفضيلات المؤسسة قانونياً في الطرفين). */
export function purchaseJobOptions(options: PurchaseImportOptions): Record<string, string | number | boolean | Record<number, string | null>> {
  return {
    ...(options.defaultSupplierId ? { default_supplier_id: options.defaultSupplierId } : {}),
    ...(options.defaultPaymentType ? { default_payment_type: options.defaultPaymentType } : {}),
    ...(options.defaultTaxRate !== null ? { default_tax_rate: options.defaultTaxRate } : {}),
    ...(options.taxInclusive ? { tax_inclusive: options.taxInclusive === 'yes' } : {}),
    ...(options.warehouseId ? { warehouse_id: options.warehouseId } : {}),
    ...(options.mapping ? { mapping: options.mapping } : {}),
  };
}

export function suggestedPurchaseMapping(columns: PurchaseInspectedColumn[]): PurchaseColumnMapping {
  const mapping: PurchaseColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mapping;
}

/** ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً. المورّد إما عمود كود أو مورّد افتراضي؛ والمنتج يكفيه أحد معرّفاته. */
export function purchaseMappingGaps(
  mapping: PurchaseColumnMapping,
  fields: PurchaseImportField[],
  options: Pick<PurchaseImportOptions, 'defaultSupplierId'>
): { missingRequired: PurchaseImportField[]; missingSupplier: boolean; missingProduct: boolean; duplicate: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

  return {
    missingRequired: fields.filter((field) => field.required && !counts.has(field.key)),
    missingSupplier: !counts.has('supplier_code') && !options.defaultSupplierId,
    missingProduct: !PRODUCT_IDENTIFIER_FIELDS.some((key) => counts.has(key)),
    duplicate: [...counts.values()].some((count) => count > 1),
  };
}

/** نسبة الضريبة كعدد صحيح 0–100 بأرقام لاتينية فقط (لا `1e1` ولا `0x10` ولا مسافات). النص الفارغ = تفضيل المؤسسة (`null`)، ولا صالح = `undefined`. */
export function parseOptionalTaxRate(text: string): number | null | undefined {
  if (text === '') return null;
  if (!/^\d{1,3}$/.test(text)) return undefined;
  const value = Number(text);

  return value <= 100 ? value : undefined;
}

export function purchaseFieldLabel(field: PurchaseImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}

/** نصٌّ آمن لجدول بيانات: بادئة صيغة (= + - @) تُعطَّل كي لا تُنفَّذ إن فُتح التقرير في Excel. */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
