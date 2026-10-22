/**
 * عقد مصنّف Products/Barcodes/Unit Prices (PR-UOM2-4) كما يعرضه الخادم —
 * لا شاشة جلسية سابقة تُنقَل هنا؛ هذه أول واجهة له، مبنيّة مباشرةً على
 * المسار الدائم (PR-DUR-3). IMP-H2-S3: خطوة فحص (`/products/workbook/inspect`) تعرض
 * الأوراق الثلاث، ومطابقة أعمدة يدوية لورقة Products وحدها (الباركودات والأسعار
 * يطابقها الخادم بالاسم ولا يقبل مطابقة يدوية لها)، وحين لا يتوفر فحص يطابق الخادم
 * تلقائياً بالاسم (`ProductImportFields::autoMap`) كما كان.
 */

import type { ImportBinding } from '@/modules/import-jobs/client';

import type {
  ColumnMapping,
  ImportField,
  ImportMode,
  BlankPolicy,
  MasterDataPolicy,
} from '@/modules/products/import/contract';

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_WORKBOOK_TYPES = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface SheetSummary {
  total_rows: number;
  error_rows: number;
  create_rows?: number;
  update_rows?: number;
  skipped_rows?: number;
  warning_rows?: number;
  errors: { row: number; messages: string[] }[];
}

export interface WorkbookPreview {
  /** معاينةٌ أحادية الاستعمال يحفظها الخادم — تُرفَق بإنشاء التشغيلة (IMP-H1-S3b). */
  binding?: ImportBinding;
  products: SheetSummary;
  barcodes: SheetSummary;
  unit_prices: SheetSummary;
  ready: boolean;
}

export type WorkbookSheetKey = 'products' | 'barcodes' | 'unit_prices';
export const WORKBOOK_SHEETS: WorkbookSheetKey[] = ['products', 'barcodes', 'unit_prices'];

export interface WorkbookInspectedSheet {
  present: boolean;
  total_rows: number;
  columns: { index: number; header: string; suggested_field: string | null }[];
}

export interface WorkbookFieldLabel {
  key: string;
  label_ar: string;
  label_en: string;
  required: boolean;
}

/** نتيجة `POST /products/workbook/inspect` (بلا تحقق ولا كتابة). */
export interface WorkbookInspection {
  sheets: Record<WorkbookSheetKey, WorkbookInspectedSheet>;
  fields: { products: ImportField[]; barcodes: WorkbookFieldLabel[]; unit_prices: WorkbookFieldLabel[] };
}

/**
 * يقبل الفحص فقط إن جاء بالشكل المتوقع؛ أي ردٍّ آخر = لا فحص. الفحص استشاريّ: غيابه لا يمنع المعاينة،
 * والخادم يطابق بالاسم تلقائياً كما كان قبل H2-S3.
 */
export function readInspection(payload: unknown): WorkbookInspection | null {
  const value = payload as Partial<WorkbookInspection> | null | undefined;
  if (!value?.sheets || !value.fields) return null;
  return WORKBOOK_SHEETS.every((key) => value.sheets?.[key]) ? (value as WorkbookInspection) : null;
}

/** أعمدة ورقةٍ لا يقبل الخادم مطابقتها يدوياً (الباركودات/الأسعار) ولم يتعرّف عليها المطابق التلقائي — تُتجاهل بصمت لولا هذا العرض. */
export function unrecognizedColumns(sheet: WorkbookInspectedSheet): string[] {
  return sheet.columns.filter((column) => column.header !== '' && !column.suggested_field).map((column) => column.header);
}

/**
 * المطابقة تُرسَل فقط حين تكون لورقة Products فحصٌ فعليّ؛ بدونه يُترك الأمر للمطابقة التلقائية الخادمية،
 * فتتطابق خيارات المعاينة والتشغيلة حرفياً (بصمة المعاينة).
 */
export function effectiveMapping(inspection: WorkbookInspection | null, mapping: ColumnMapping): ColumnMapping | undefined {
  const sheet = inspection?.sheets.products;
  return sheet?.present && sheet.total_rows > 0 && sheet.columns.length > 0 ? mapping : undefined;
}

export function workbookFormData(
  file: File,
  options: {
    priceListId: string;
    mode?: ImportMode;
    blankPolicy?: BlankPolicy;
    masterDataPolicy?: MasterDataPolicy;
    mapping?: ColumnMapping;
  }
): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('price_list_id', options.priceListId);
  if (options.mode) form.append('mode', options.mode);
  if (options.blankPolicy) form.append('blank_policy', options.blankPolicy);
  if (options.masterDataPolicy) form.append('master_data_policy', options.masterDataPolicy);
  if (options.mapping) {
    for (const [index, key] of Object.entries(options.mapping)) {
      // العمود المتجاهَل يُرسَل `ignore` صراحةً كي لا تعيده المطابقة التلقائية.
      form.append(`mapping[${index}]`, key ?? 'ignore');
    }
  }
  return form;
}
