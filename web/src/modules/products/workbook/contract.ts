/**
 * عقد مصنّف Products/Barcodes/Unit Prices (PR-UOM2-4) كما يعرضه الخادم —
 * لا شاشة جلسية سابقة تُنقَل هنا؛ هذه أول واجهة له، مبنيّة مباشرةً على
 * المسار الدائم (PR-DUR-3). لا مطابقة أعمدة يدوية لورقة Products في هذه
 * النسخة الأولى — الخادم يطابق تلقائياً بالاسم (`ProductImportFields::autoMap`)
 * تماماً كسلوك الاستيراد الأساسي حين لا تُرسَل مطابقةٌ صريحة.
 */

import type { ImportMode, BlankPolicy, MasterDataPolicy } from '@/modules/products/import/contract';

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
  products: SheetSummary;
  barcodes: SheetSummary;
  unit_prices: SheetSummary;
  ready: boolean;
}

export function workbookFormData(
  file: File,
  options: {
    priceListId: string;
    mode?: ImportMode;
    blankPolicy?: BlankPolicy;
    masterDataPolicy?: MasterDataPolicy;
  }
): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('price_list_id', options.priceListId);
  if (options.mode) form.append('mode', options.mode);
  if (options.blankPolicy) form.append('blank_policy', options.blankPolicy);
  if (options.masterDataPolicy) form.append('master_data_policy', options.masterDataPolicy);
  return form;
}
