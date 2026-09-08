/**
 * توكنز عرض Retail V2 فقط (`composition: retail_v2`).
 * مستند تجاري سريع المسح — المنتج أولاً. مستقل عن Modern/ERP/Classic/Minimal V2 وعن retail التاريخي.
 * لا تُحفظ في المراجعة ولا تغيّر عقود التجميد أو الحساب.
 */

import { describe, expect, it } from 'vitest';
import {
  RETAIL_V2,
  RETAIL_V2_DEFAULT_COLUMN_WIDTH_SUM,
  RETAIL_V2_ITEMS_ROW_CLASS,
  RETAIL_V2_ITEMS_TABLE_CLASS,
  retailItemsColumnWidthClass,
  retailItemsValueCellClass,
} from './retail-v2';
import { CLASSIC_V2, classicItemsColumnWidthClass } from './classic-v2';
import { ERP_V2, erpItemsColumnWidthClass } from './erp-v2';
import { MINIMAL_V2, minimalItemsColumnWidthClass } from './minimal-v2';
import { VISUAL_V2, modernItemsColumnWidthClass } from './visual-v2';

describe('توكنز Retail V2', () => {
  it('يبقي الجدول table-fixed والباركود الأوضح والوصف بين Classic وERP والمجموع 100%', () => {
    expect(RETAIL_V2_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(RETAIL_V2_ITEMS_TABLE_CLASS).toContain('text-[11px]');
    expect(RETAIL_V2_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(retailItemsColumnWidthClass('description')).toBe('w-[28%]');
    expect(retailItemsColumnWidthClass('barcode')).toBe('w-[10%]');
    expect(RETAIL_V2_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
    expect(Number(retailItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(classicItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(retailItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeLessThan(
      Number(erpItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(retailItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeLessThan(
      Number(minimalItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(retailItemsColumnWidthClass('barcode').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(classicItemsColumnWidthClass('barcode').replace(/[^\d]/g, '')),
    );
    expect(Number(retailItemsColumnWidthClass('barcode').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(modernItemsColumnWidthClass('barcode').replace(/[^\d]/g, '')),
    );
  });

  it('يلف الوصف ويبقي الأرقام والباركود في سطر واحد', () => {
    expect(retailItemsValueCellClass('description')).toContain('break-words');
    expect(retailItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(retailItemsValueCellClass('barcode')).toContain('whitespace-nowrap');
    expect(retailItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار وQR بين ERP وClassic دون نسخ العائلات الأخرى', () => {
    expect(RETAIL_V2.logoMaxPx).toBe(38);
    expect(RETAIL_V2.qrSizePx).toBe(66);
    expect(RETAIL_V2.logoMaxPx).toBeGreaterThan(ERP_V2.logoMaxPx);
    expect(RETAIL_V2.logoMaxPx).toBeLessThan(CLASSIC_V2.logoMaxPx);
    expect(RETAIL_V2.qrSizePx).toBeGreaterThan(ERP_V2.qrSizePx);
    expect(RETAIL_V2.qrSizePx).toBeLessThan(CLASSIC_V2.qrSizePx);
    expect(RETAIL_V2.qrSizePx).toBeGreaterThan(MINIMAL_V2.qrSizePx);
    expect(RETAIL_V2.qrSizePx).toBeLessThan(VISUAL_V2.qrSizePx);
  });
});
