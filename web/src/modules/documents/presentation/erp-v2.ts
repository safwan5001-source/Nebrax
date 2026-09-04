/**
 * توكنز عرض ERP V2 فقط (`composition: erp_v2`).
 * دفتر يومي كثيف مستقل عن Modern V2 وعن `tax-invoice-erp` التاريخي.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const ERP_V2 = {
  logoMaxPx: 36,
  logoMaxWidthClass: 'max-h-9 max-w-[5.5rem] w-auto shrink-0 object-contain object-start',
  qrSizePx: 64,
  totalsMaxClass: 'w-full max-w-[260px]',
} as const;

export function cappedErpLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return ERP_V2.logoMaxPx;
  return Math.min(requested, ERP_V2.logoMaxPx);
}

export const ERP_V2_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[10px] leading-tight';
export const ERP_V2_ITEMS_HEAD_CLASS = 'border-b-2 border-black text-black';
export const ERP_V2_ITEMS_ROW_CLASS = 'border-b border-black/20';

/**
 * نسب أعمدة ERP V2: الوصف الأوسع، والمالية أضيق. المجموع = 100%.
 * لا تُنسخ نسب Modern V2.
 */
export function erpItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[3%]';
    case 'product_code':
      return 'w-[7%]';
    case 'barcode':
      return 'w-[7%]';
    case 'product':
      return 'w-[15%]';
    case 'description':
      return 'w-[30%]';
    case 'quantity':
      return 'w-[5%]';
    case 'unit_price':
      return 'w-[7%]';
    case 'price_before_tax':
      return 'w-[8%]';
    case 'tax':
      return 'w-[7%]';
    case 'total':
      return 'w-[11%]';
  }
}

export function erpItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'description') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-tight';
  }
  if (column === 'product') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-tight';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[9px] leading-tight';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9px]';
  }
  return 'whitespace-nowrap text-[10px]';
}

export function erpItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-1 py-1'
    : 'px-1 py-1';
}

export const ERP_V2_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(erpItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
