/**
 * توكنز عرض قالب عرض السعر الإنتاجي فقط (`composition: quotation_proposal`).
 * مستند قرار / عرض مهني — مستقل عن كل هويات الفاتورة التاريخية وV2.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const QUOTATION_PROPOSAL = {
  logoMaxPx: 38,
  logoMaxWidthClass: 'max-h-[38px] max-w-[6.5rem] w-auto shrink-0 object-contain object-start',
  totalsMaxClass: 'w-full max-w-[292px]',
} as const;

export function cappedQuotationLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return QUOTATION_PROPOSAL.logoMaxPx;
  return Math.min(requested, QUOTATION_PROPOSAL.logoMaxPx);
}

export const QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[11px] leading-relaxed';
export const QUOTATION_PROPOSAL_ITEMS_HEAD_CLASS = 'border-b border-[color:var(--border)] text-black';
export const QUOTATION_PROPOSAL_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

/**
 * نسب أعمدة عرض السعر: الوصف البطل 33% (أوسع من ERP 30%).
 * المجموع = 100%. لا تُنسخ نسب قوالب الفاتورة.
 */
export function quotationItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[4%]';
    case 'product_code':
      return 'w-[7%]';
    case 'barcode':
      return 'w-[7%]';
    case 'product':
      return 'w-[14%]';
    case 'description':
      return 'w-[33%]';
    case 'quantity':
      return 'w-[6%]';
    case 'unit_price':
      return 'w-[8%]';
    case 'price_before_tax':
      return 'w-[7%]';
    case 'tax':
      return 'w-[7%]';
    case 'total':
      return 'w-[7%]';
  }
}

export function quotationItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'description') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-relaxed';
  }
  if (column === 'product') {
    return 'min-w-0 break-words whitespace-normal text-[11px] leading-relaxed';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-snug';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px]';
  }
  return 'whitespace-nowrap text-[11px]';
}

export function quotationItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-2 py-2'
    : 'px-2 py-2';
}

export const QUOTATION_PROPOSAL_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(quotationItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
