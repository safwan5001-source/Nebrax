import { describe, expect, it } from 'vitest';
import {
  PURCHASE_ORDER_FORMAL,
  PURCHASE_ORDER_FORMAL_DEFAULT_COLUMN_WIDTH_SUM,
  PURCHASE_ORDER_FORMAL_ITEMS_ROW_CLASS,
  PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS,
  purchaseOrderItemsColumnWidthClass,
  purchaseOrderItemsValueCellClass,
} from './purchase-order-formal';
import { quotationItemsColumnWidthClass, QUOTATION_PROPOSAL } from './quotation-proposal';
import { ERP_V2, erpItemsColumnWidthClass } from './erp-v2';
import { CLASSIC_V2 } from './classic-v2';
import { VISUAL_V2 } from './visual-v2';
import { RETAIL_V2 } from './retail-v2';
import { MINIMAL_V2 } from './minimal-v2';

describe('توكنز Purchase Order Formal', () => {
  it('يبقي الجدول table-fixed والمنتج+الوصف البطل والمجموع 100%', () => {
    expect(PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS).toContain('text-[10px]');
    expect(PURCHASE_ORDER_FORMAL_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(purchaseOrderItemsColumnWidthClass('description')).toBe('w-[30%]');
    expect(purchaseOrderItemsColumnWidthClass('product')).toBe('w-[16%]');
    expect(purchaseOrderItemsColumnWidthClass('product_code')).toBe('w-[10%]');
    expect(PURCHASE_ORDER_FORMAL_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
    expect(
      Number(purchaseOrderItemsColumnWidthClass('product').replace(/[^\d]/g, ''))
      + Number(purchaseOrderItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    ).toBeGreaterThan(Number(purchaseOrderItemsColumnWidthClass('product_code').replace(/[^\d]/g, '')));
    expect(Number(purchaseOrderItemsColumnWidthClass('product_code').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(quotationItemsColumnWidthClass('product_code').replace(/[^\d]/g, '')),
    );
    expect(Number(purchaseOrderItemsColumnWidthClass('product_code').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(erpItemsColumnWidthClass('product_code').replace(/[^\d]/g, '')),
    );
  });

  it('يلف الوصف ويبقي الأرقام في سطر واحد', () => {
    expect(purchaseOrderItemsValueCellClass('description')).toContain('break-words');
    expect(purchaseOrderItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(purchaseOrderItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار بهوية مستقلة دون نسخ عرض السعر أو قوالب الفاتورة ودون QR', () => {
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).toBe(39);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(QUOTATION_PROPOSAL.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(VISUAL_V2.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(ERP_V2.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(CLASSIC_V2.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(MINIMAL_V2.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL.logoMaxPx).not.toBe(RETAIL_V2.logoMaxPx);
    expect(PURCHASE_ORDER_FORMAL).not.toHaveProperty('qrSizePx');
  });
});
