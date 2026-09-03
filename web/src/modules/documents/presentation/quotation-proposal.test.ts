import { describe, expect, it } from 'vitest';
import {
  QUOTATION_PROPOSAL,
  QUOTATION_PROPOSAL_DEFAULT_COLUMN_WIDTH_SUM,
  QUOTATION_PROPOSAL_ITEMS_ROW_CLASS,
  QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS,
  quotationItemsColumnWidthClass,
  quotationItemsValueCellClass,
} from './quotation-proposal';
import { ERP_V2, erpItemsColumnWidthClass } from './erp-v2';
import { CLASSIC_V2, classicItemsColumnWidthClass } from './classic-v2';
import { VISUAL_V2 } from './visual-v2';
import { RETAIL_V2 } from './retail-v2';
import { MINIMAL_V2 } from './minimal-v2';

describe('توكنز Quotation Proposal', () => {
  it('يبقي الجدول table-fixed والوصف أوسع من ERP والمجموع 100%', () => {
    expect(QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS).toContain('text-[11px]');
    expect(QUOTATION_PROPOSAL_ITEMS_ROW_CLASS).not.toMatch(/brand-soft/);
    expect(quotationItemsColumnWidthClass('description')).toBe('w-[33%]');
    expect(quotationItemsColumnWidthClass('product')).toBe('w-[14%]');
    expect(QUOTATION_PROPOSAL_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
    expect(Number(quotationItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(erpItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
    expect(Number(quotationItemsColumnWidthClass('description').replace(/[^\d]/g, ''))).toBeGreaterThan(
      Number(classicItemsColumnWidthClass('description').replace(/[^\d]/g, '')),
    );
  });

  it('يلف الوصف ويبقي الأرقام في سطر واحد', () => {
    expect(quotationItemsValueCellClass('description')).toContain('break-words');
    expect(quotationItemsValueCellClass('total')).toContain('whitespace-nowrap');
    expect(quotationItemsValueCellClass('barcode')).not.toContain('break-all');
  });

  it('يسقّف الشعار بهوية مستقلة دون نسخ قوالب الفاتورة ودون QR', () => {
    expect(QUOTATION_PROPOSAL.logoMaxPx).toBe(38);
    expect(QUOTATION_PROPOSAL.logoMaxPx).not.toBe(VISUAL_V2.logoMaxPx);
    expect(QUOTATION_PROPOSAL.logoMaxPx).not.toBe(ERP_V2.logoMaxPx);
    expect(QUOTATION_PROPOSAL.logoMaxPx).not.toBe(CLASSIC_V2.logoMaxPx);
    expect(QUOTATION_PROPOSAL.logoMaxPx).not.toBe(MINIMAL_V2.logoMaxPx);
    expect(QUOTATION_PROPOSAL.logoMaxPx).not.toBe(RETAIL_V2.logoMaxPx);
    expect(QUOTATION_PROPOSAL).not.toHaveProperty('qrSizePx');
  });
});
