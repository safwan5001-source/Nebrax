import { describe, expect, it } from 'vitest';
import {
  ERP_V2,
  ERP_V2_DEFAULT_COLUMN_WIDTH_SUM,
  ERP_V2_ITEMS_ROW_CLASS,
  ERP_V2_ITEMS_TABLE_CLASS,
  erpItemsColumnWidthClass,
  erpItemsValueCellClass,
} from './erp-v2';

describe('توكنز ERP V2', () => {
  it('يبقي الجدول كثيفاً والوصف الأوسع والمجموع 100%', () => {
    expect(ERP_V2_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(ERP_V2_ITEMS_TABLE_CLASS).toContain('text-[10px]');
    expect(ERP_V2_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(erpItemsColumnWidthClass('description')).toBe('w-[30%]');
    expect(erpItemsColumnWidthClass('product')).toBe('w-[15%]');
    expect(ERP_V2_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
  });

  it('يلف الوصف ويبقي الأرقام في سطر واحد', () => {
    expect(erpItemsValueCellClass('description')).toContain('break-words');
    expect(erpItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(erpItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار وQR دون نسخ مقاسات Modern', () => {
    expect(ERP_V2.logoMaxPx).toBe(28);
    expect(ERP_V2.qrSizePx).toBe(64);
    expect(ERP_V2.logoMaxPx).toBeLessThan(36);
    expect(ERP_V2.qrSizePx).toBeLessThan(76);
  });
});
