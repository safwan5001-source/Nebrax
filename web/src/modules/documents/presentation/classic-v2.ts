/**
 * توكنز عرض Classic V2 فقط (`composition: classic_v2`).
 * مستند رسمي تقليدي متوسط الكثافة — مستقل عن Modern V2 وERP V2 وعن classic التاريخي.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const CLASSIC_V2 = {
  logoMaxPx: 32,
  logoMaxWidthClass: 'max-h-8 max-w-[5rem] w-auto shrink-0 object-contain object-start',
  qrSizePx: 70,
  totalsMaxClass: 'w-full max-w-[280px]',
} as const;

export function cappedClassicLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return CLASSIC_V2.logoMaxPx;
  return Math.min(requested, CLASSIC_V2.logoMaxPx);
}

export const CLASSIC_V2_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[11px] leading-snug';
export const CLASSIC_V2_ITEMS_HEAD_CLASS = 'border-y border-black text-black';
export const CLASSIC_V2_ITEMS_ROW_CLASS = 'border-b border-black/15';

/**
 * نسب أعمدة Classic V2: الوصف أوسع من Modern (21%) وأضيق من ERP (30%).
 * المجموع = 100%. لا تُنسخ نسب القوالب الأخرى.
 */
export function classicItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[3%]';
    case 'product_code':
      return 'w-[8%]';
    case 'barcode':
      return 'w-[8%]';
    case 'product':
      return 'w-[16%]';
    case 'description':
      return 'w-[26%]';
    case 'quantity':
      return 'w-[5%]';
    case 'unit_price':
      return 'w-[8%]';
    case 'price_before_tax':
      return 'w-[9%]';
    case 'tax':
      return 'w-[8%]';
    case 'total':
      return 'w-[9%]';
  }
}

export function classicItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'description') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-snug';
  }
  if (column === 'product') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-snug';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-snug';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px]';
  }
  return 'whitespace-nowrap text-[11px]';
}

export function classicItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-1.5 py-1.5'
    : 'px-1.5 py-1.5';
}

export const CLASSIC_V2_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(classicItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
