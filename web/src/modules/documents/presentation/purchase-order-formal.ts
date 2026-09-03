/**
 * توكنز عرض قالب أمر الشراء الإنتاجي فقط (`composition: purchase_order_formal`).
 * مستند توريد رسمي تشغيلي موجّه للمورّد — مستقل عن عرض السعر وعن كل هويات الفاتورة.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import type { DocItemsColumnId } from '../types';

export const PURCHASE_ORDER_FORMAL = {
  logoMaxPx: 31,
  logoMaxWidthClass: 'max-h-[31px] max-w-[5rem] w-auto shrink-0 object-contain object-start',
  totalsMaxClass: 'w-full max-w-[268px]',
} as const;

export function cappedPurchaseOrderLogoHeight(requested?: number | null): number {
  if (!requested || requested <= 0) return PURCHASE_ORDER_FORMAL.logoMaxPx;
  return Math.min(requested, PURCHASE_ORDER_FORMAL.logoMaxPx);
}

export const PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS = 'w-full table-fixed border-collapse text-[10px] leading-snug';
export const PURCHASE_ORDER_FORMAL_ITEMS_HEAD_CLASS = 'border-b-2 border-[color:var(--border)] text-black';
export const PURCHASE_ORDER_FORMAL_ITEMS_ROW_CLASS = 'border-b border-[color:var(--border)]';

/**
 * نسب أعمدة أمر الشراء: المنتج+الوصف البطل، ثم رمز الصنف أوسع من عرض السعر.
 * المجموع = 100%. لا تُنسخ نسب الفاتورة ولا `quotation-proposal`.
 */
export function purchaseOrderItemsColumnWidthClass(column: DocItemsColumnId): string {
  switch (column) {
    case 'number':
      return 'w-[4%]';
    case 'product_code':
      return 'w-[10%]';
    case 'barcode':
      return 'w-[7%]';
    case 'product':
      return 'w-[16%]';
    case 'description':
      return 'w-[30%]';
    case 'quantity':
      return 'w-[7%]';
    case 'unit_price':
      return 'w-[8%]';
    case 'price_before_tax':
      return 'w-[6%]';
    case 'tax':
      return 'w-[6%]';
    case 'total':
      return 'w-[6%]';
  }
}

export function purchaseOrderItemsValueCellClass(column: DocItemsColumnId): string {
  if (column === 'description' || column === 'product') {
    return 'min-w-0 break-words whitespace-normal text-[10px] leading-snug';
  }
  if (column === 'product_code') {
    return 'min-w-0 break-words whitespace-normal text-[9px] leading-snug';
  }
  if (column === 'barcode') {
    return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9px]';
  }
  return 'whitespace-nowrap text-[10px]';
}

export function purchaseOrderItemsCellPadding(column: DocItemsColumnId): string {
  return column === 'description' || column === 'product'
    ? 'px-1.5 py-1.5'
    : 'px-1.5 py-1';
}

export const PURCHASE_ORDER_FORMAL_DEFAULT_COLUMN_WIDTH_SUM = (
  ['number', 'product_code', 'barcode', 'product', 'description', 'quantity', 'unit_price', 'price_before_tax', 'tax', 'total'] as const
).reduce((sum, column) => sum + Number(purchaseOrderItemsColumnWidthClass(column).replace(/[^\d]/g, '')), 0);
