/**
 * توكنز عرض Minimal V2 فقط (`composition: minimal_v2`).
 * مستند هادئ قائم على البياض والطبعة — مستقل عن Modern/ERP/Classic V2 وعن minimal التاريخي.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const MINIMAL_V2 = {
  logoMaxPx: 42,
  logoMaxWidthClass: 'max-h-[42px] max-w-[6.25rem] w-auto shrink-0 object-contain object-start',
  qrSizePx: 60,
  totalsMaxClass: 'w-full max-w-[288px]',
} as const;

export function cappedMinimalLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return MINIMAL_V2.logoMaxPx;
  return Math.min(requested, MINIMAL_V2.logoMaxPx);
}

export const MINIMAL_V2_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[11px] leading-relaxed';
export const MINIMAL_V2_ITEMS_HEAD_CLASS = 'border-b border-[color:var(--border)] text-black';
export const MINIMAL_V2_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

/**
 * نسب أعمدة Minimal V2: الوصف الأوسع بين عائلات V2 (32%).
 * المجموع = 100%. لا تُنسخ نسب القوالب الأخرى.
 */
export function minimalItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[3%]';
    case 'product_code':
      return 'w-[7%]';
    case 'barcode':
      return 'w-[7%]';
    case 'product':
      return 'w-[14%]';
    case 'description':
      return 'w-[32%]';
    case 'quantity':
      return 'w-[5%]';
    case 'unit_price':
      return 'w-[7%]';
    case 'price_before_tax':
      return 'w-[8%]';
    case 'tax':
      return 'w-[7%]';
    case 'total':
      return 'w-[10%]';
  }
}

export function minimalItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'description') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-relaxed';
  }
  if (column === 'product') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-relaxed';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-relaxed';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px]';
  }
  return 'whitespace-nowrap text-[11px]';
}

export function minimalItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-3 py-3'
    : 'px-3 py-2.5';
}

export const MINIMAL_V2_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(minimalItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
