/**
 * عقد استيراد بنود إذنٍ مخزني (IMP-H7-S3) كما يعرضه الخادم (`/stock-permits/import/*`). **الملف = إذن مسودة واحد**: رأس الإذن (النوع والمخزن ومخزن الوجهة والتاريخ والسبب
 * والملاحظات وسياسة التكلفة الصفرية) خياراتٌ مجمَّدة للتشغيلة لا أعمدة في الملف، والصفوف بنودٌ. الاستيراد **ينشئ مسودة فقط**: لا حركة مخزون ولا قيد؛ الترحيل فعلٌ منفصل
 * من صفحة الإذن. لا تطبيق متزامن: التنفيذ عبر تشغيلة دائمة مربوطة بالمعاينة.
 */
import type { ImportBinding } from '@/modules/import-jobs/client';

export type StockPermitType = 'receipt' | 'issue' | 'transfer';
export const STOCK_PERMIT_TYPES: StockPermitType[] = ['receipt', 'issue', 'transfer'];
export type StockPermitRowAction = 'line' | 'error';

export const MAX_STOCK_PERMIT_IMPORT_BYTES = 5 * 1024 * 1024;
export const STOCK_PERMIT_IMPORT_ROW_LIMIT = 2000;
export const ACCEPTED_STOCK_PERMIT_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** أي واحد منها يكفي لتعريف الصنف؛ الاسم ليس معرّفاً. */
export const STOCK_PERMIT_PRODUCT_IDENTIFIERS = ['product_id', 'sku', 'barcode'];

export interface StockPermitImportField {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface StockPermitInspectedColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface StockPermitInspectResult {
  columns: StockPermitInspectedColumn[];
  total_rows: number;
  fields: StockPermitImportField[];
}

export interface StockPermitPreviewRow {
  row: number;
  action: StockPermitRowAction;
  status: string;
  valid: boolean;
  sku: string | null;
  barcode: string | null;
  product_name: string | null;
  quantity: number | null;
  unit: string | null;
  /** هللات (يخص إذن الإضافة وحده). */
  unit_cost: number | null;
  line_cost: number | null;
  messages: string[];
  warnings: string[];
}

export interface StockPermitImportPreview {
  binding?: ImportBinding;
  permit_type: StockPermitType;
  /** التاريخ المحسوم (الافتراضي يُحسم عند المعاينة ويتجمّد مع بصمتها). */
  permit_date: string;
  warehouse_id: string;
  warehouse_name: string | null;
  target_warehouse_id: string | null;
  target_warehouse_name: string | null;
  allow_zero_cost: boolean;
  total_rows: number;
  line_rows: number;
  warning_rows: number;
  error_rows: number;
  /** هللات. */
  total_cost: number;
  rows: StockPermitPreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
}

/** فهرس العمود → مفتاح الحقل أو `null` (متجاهَل). */
export type StockPermitColumnMapping = Record<number, string | null>;

/** رأس الإذن كما يختاره المستخدم. التاريخ الفارغ = «اليوم» يحسمه الخادم عند المعاينة. */
export interface StockPermitHeader {
  permitType: StockPermitType | '';
  warehouseId: string;
  targetWarehouseId: string;
  permitDate: string;
  reason: string;
  notes: string;
  allowZeroCost: boolean;
}

export const EMPTY_STOCK_PERMIT_HEADER: StockPermitHeader = {
  permitType: '',
  warehouseId: '',
  targetWarehouseId: '',
  permitDate: '',
  reason: '',
  notes: '',
  allowZeroCost: false,
};

/** ما ينقص الرأس قبل رفع الملف أو المعاينة — يرفض الخادم أيضاً فعلياً (الفحص نفسه يلزمه النوع والمخزن). */
export function stockPermitHeaderGaps(header: StockPermitHeader): { missingType: boolean; missingWarehouse: boolean; missingTarget: boolean; sameWarehouse: boolean } {
  const transfer = header.permitType === 'transfer';
  return {
    missingType: header.permitType === '',
    missingWarehouse: header.warehouseId === '',
    missingTarget: transfer && header.targetWarehouseId === '',
    sameWarehouse: transfer && header.targetWarehouseId !== '' && header.targetWarehouseId === header.warehouseId,
  };
}

export function stockPermitHeaderReady(header: StockPermitHeader): boolean {
  const gaps = stockPermitHeaderGaps(header);
  return !gaps.missingType && !gaps.missingWarehouse && !gaps.missingTarget && !gaps.sameWarehouse;
}

/** مخزن الوجهة يخص التحويل وحده (الخادم يرفضه لغيره)، فلا يُرسَل لغيره مهما بقي في الحالة. */
function effectiveTarget(header: StockPermitHeader): string {
  return header.permitType === 'transfer' ? header.targetWarehouseId : '';
}

function appendHeader(form: FormData, header: StockPermitHeader) {
  form.append('permit_type', header.permitType);
  form.append('warehouse_id', header.warehouseId);
  const target = effectiveTarget(header);
  if (target) form.append('target_warehouse_id', target);
  if (header.permitDate) form.append('permit_date', header.permitDate);
  if (header.reason.trim()) form.append('reason', header.reason.trim());
  if (header.notes.trim()) form.append('notes', header.notes.trim());
  if (header.allowZeroCost && header.permitType === 'receipt') form.append('allow_zero_cost', '1');
}

/** الفحص يحتاج النوع والمخزن (قواعد الطلب نفسها للمعاينة) ولا يقرأ سواهما. */
export function stockPermitInspectFormData(file: File, header: StockPermitHeader): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('permit_type', header.permitType);
  form.append('warehouse_id', header.warehouseId);
  const target = effectiveTarget(header);
  if (target) form.append('target_warehouse_id', target);
  return form;
}

export function stockPermitPreviewFormData(file: File, header: StockPermitHeader, mapping?: StockPermitColumnMapping): FormData {
  const form = new FormData();
  form.append('file', file);
  appendHeader(form, header);
  if (mapping) {
    for (const [index, key] of Object.entries(mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيد المطابقة التلقائية ربطه.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}

/**
 * خيارات التشغيلة الدائمة (`options[...]`) — مطابقة لما أُرسل إلى المعاينة كي تتطابق بصمتها. **التاريخ هو المحسوم من المعاينة** لا الحقل الفارغ: وإلا حُسم «اليوم» ثانيةً
 * عند الإنشاء فاختلف عبر منتصف الليل عن بصمة المعاينة.
 */
export function stockPermitJobOptions(header: StockPermitHeader, resolvedDate: string, mapping?: StockPermitColumnMapping): Record<string, string | boolean | Record<number, string | null>> {
  const target = effectiveTarget(header);
  return {
    permit_type: header.permitType,
    warehouse_id: header.warehouseId,
    ...(target ? { target_warehouse_id: target } : {}),
    permit_date: resolvedDate,
    ...(header.reason.trim() ? { reason: header.reason.trim() } : {}),
    ...(header.notes.trim() ? { notes: header.notes.trim() } : {}),
    ...(header.allowZeroCost && header.permitType === 'receipt' ? { allow_zero_cost: true } : {}),
    ...(mapping ? { mapping } : {}),
  };
}

/** عمود التكلفة يخص إذن الإضافة وحده: لغيره يُتجاهَل تلقائياً كي لا يُحظر الملف المشترك (قالب واحد) بعمودٍ ربطته المطابقة التلقائية. */
export function mappingForPermitType(mapping: StockPermitColumnMapping, type: StockPermitType | ''): StockPermitColumnMapping {
  if (type === 'receipt' || type === '') return mapping;
  return Object.fromEntries(Object.entries(mapping).map(([index, key]) => [index, key === 'unit_cost' ? null : key]));
}

export function suggestedStockPermitMapping(columns: StockPermitInspectedColumn[], type: StockPermitType | ''): StockPermitColumnMapping {
  const mapping: StockPermitColumnMapping = {};
  columns.forEach((column) => {
    mapping[column.index] = column.suggested_field;
  });
  return mappingForPermitType(mapping, type);
}

/**
 * ما ينقص المطابقة قبل السماح بالمعاينة — يرفض الخادم أيضاً فعلياً: عمود تعريف + الكمية؛ التكلفة عمودٌ لإذن الإضافة وحده (محظورة لغيره)،
 * وإذن الإضافة بلا عمود تكلفة يلزمه «السماح بتكلفة صفر» صراحةً.
 */
export function stockPermitMappingGaps(
  mapping: StockPermitColumnMapping,
  header: Pick<StockPermitHeader, 'permitType' | 'allowZeroCost'>
): { missingIdentifier: boolean; missingQuantity: boolean; duplicate: boolean; costOnNonReceipt: boolean; missingCost: boolean } {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  chosen.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
  const hasCost = counts.has('unit_cost');

  return {
    missingIdentifier: !STOCK_PERMIT_PRODUCT_IDENTIFIERS.some((key) => counts.has(key)),
    missingQuantity: !counts.has('quantity'),
    duplicate: [...counts.values()].some((count) => count > 1),
    costOnNonReceipt: header.permitType !== 'receipt' && hasCost,
    missingCost: header.permitType === 'receipt' && !hasCost && !header.allowZeroCost,
  };
}

export function stockPermitFieldLabel(field: StockPermitImportField, locale: string): string {
  return locale.startsWith('ar') ? field.label_ar : field.label_en;
}
