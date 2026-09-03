import { describe, expect, it } from 'vitest';
import {
  MINIMAL_V2,
  MINIMAL_V2_DEFAULT_COLUMN_WIDTH_SUM,
  MINIMAL_V2_ITEMS_ROW_CLASS,
  MINIMAL_V2_ITEMS_TABLE_CLASS,
  minimalItemsColumnWidthClass,
  minimalItemsValueCellClass,
} from './minimal-v2';
import { CLASSIC_V2, classicItemsColumnWidthClass } from './classic-v2';
import { ERP_V2, erpItemsColumnWidthClass } from './erp-v2';
import { VISUAL_V2, modernItemsColumnWidthClass } from './visual-v2';

describe('توكنز Minimal V2', () => {
  it('يبقي الجدول table-fixed والوصف الأوسع والمجموع 100%', () => {
    expect(MINIMAL_V2_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(MINIMAL_V2_ITEMS_TABLE_CLASS).toContain('text-[11px]');
    expect(MINIMAL_V2_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(MINIMAL_V2_ITEMS_ROW_CLASS).not.toContain('border-black/15');
    expect(minimalItemsColumnWidthClass('description')).toBe('w-[32%]');
    expect(MINIMAL_V2_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
    expect(Number(minimalItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(erpItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(minimalItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(classicItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(minimalItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(modernItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
  });

  it('يلف الوصف ويبقي الأرقام في سطر واحد', () => {
    expect(minimalItemsValueCellClass('description')).toContain('break-words');
    expect(minimalItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(minimalItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار وQR دون نسخ عائلات V2 الأخرى', () => {
    expect(MINIMAL_V2.logoMaxPx).toBe(34);
    expect(MINIMAL_V2.qrSizePx).toBe(60);
    expect(MINIMAL_V2.logoMaxPx).toBeGreaterThan(CLASSIC_V2.logoMaxPx);
    expect(MINIMAL_V2.logoMaxPx).toBeLessThan(VISUAL_V2.logoMaxPx);
    expect(MINIMAL_V2.qrSizePx).toBeLessThan(ERP_V2.qrSizePx);
    expect(MINIMAL_V2.qrSizePx).toBeLessThan(CLASSIC_V2.qrSizePx);
    expect(MINIMAL_V2.qrSizePx).toBeLessThan(VISUAL_V2.qrSizePx);
  });
});
