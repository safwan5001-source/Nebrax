import { describe, expect, it } from 'vitest';
import {
  CLASSIC_V2,
  CLASSIC_V2_DEFAULT_COLUMN_WIDTH_SUM,
  CLASSIC_V2_ITEMS_ROW_CLASS,
  CLASSIC_V2_ITEMS_TABLE_CLASS,
  classicItemsColumnWidthClass,
  classicItemsValueCellClass,
} from './classic-v2';
import { ERP_V2, erpItemsColumnWidthClass } from './erp-v2';
import { VISUAL_V2, modernItemsColumnWidthClass } from './visual-v2';

describe('توكنز Classic V2', () => {
  it('يبقي الجدول table-fixed والوصف بين Modern وERP والمجموع 100%', () => {
    expect(CLASSIC_V2_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(CLASSIC_V2_ITEMS_TABLE_CLASS).toContain('text-[11px]');
    expect(CLASSIC_V2_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(classicItemsColumnWidthClass('description')).toBe('w-[26%]');
    expect(classicItemsColumnWidthClass('product')).toBe('w-[16%]');
    expect(CLASSIC_V2_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
    expect(Number(classicItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(modernItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(classicItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeLessThan(
      Number(erpItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
  });

  it('يلف الوصف ويبقي الأرقام في سطر واحد', () => {
    expect(classicItemsValueCellClass('description')).toContain('break-words');
    expect(classicItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(classicItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار وQR بين Modern وERP دون نسخهما', () => {
    expect(CLASSIC_V2.logoMaxPx).toBe(40);
    expect(CLASSIC_V2.qrSizePx).toBe(70);
    expect(CLASSIC_V2.logoMaxPx).toBeGreaterThan(ERP_V2.logoMaxPx);
    expect(CLASSIC_V2.logoMaxPx).toBeLessThan(VISUAL_V2.logoMaxPx);
    expect(CLASSIC_V2.qrSizePx).toBeGreaterThan(ERP_V2.qrSizePx);
    expect(CLASSIC_V2.qrSizePx).toBeLessThan(VISUAL_V2.qrSizePx);
  });
});
