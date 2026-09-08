/**
 * توكنز عرض Retail V2 فقط (`composition: retail_v2`).
 * مستند تجاري سريع المسح — المنتج أولاً. مستقل عن Modern/ERP/Classic/Minimal V2 وعن retail التاريخي.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const RETAIL_V2 = {
  logoMaxPx: 38,
  logoMaxWidthClass: 'max-h-[38px] max-w-[5.75rem] w-auto shrink-0 object-contain object-start',
  qrSizePx: 66,
  totalsMaxClass: 'w-full max-w-[276px]',
} as const;

export function cappedRetailLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return RETAIL_V2.logoMaxPx;
  return Math.min(requested, RETAIL_V2.logoMaxPx);
}

export const RETAIL_V2_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[11px] leading-snug';
export const RETAIL_V2_ITEMS_HEAD_CLASS = 'border-b border-[color:var(--border)] text-black';
export const RETAIL_V2_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

/**
 * نسب أعمدة Retail V2: باركود أوضح (10%) ووصف 28% بين Classic 26% وERP 30%.
 * المجموع = 100%. لا تُنسخ نسب القوالب الأخرى.
 */
export function retailItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[3%]';
    case 'product_code':
      return 'w-[8%]';
    case 'barcode':
      return 'w-[10%]';
    case 'product':
      return 'w-[16%]';
    case 'description':
      return 'w-[28%]';
    case 'quantity':
      return 'w-[6%]';
    case 'unit_price':
      return 'w-[7%]';
    case 'price_before_tax':
      return 'w-[7%]';
    case 'tax':
      return 'w-[6%]';
    case 'total':
      return 'w-[9%]';
  }
}

export function retailItemsValueCellClass(column: DocItemsColumnId): string {
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
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] num';
  }
  return 'whitespace-nowrap text-[11px]';
}

export function retailItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-1.5 py-1.5'
    : 'px-1.5 py-1';
}

export const RETAIL_V2_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(retailItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
