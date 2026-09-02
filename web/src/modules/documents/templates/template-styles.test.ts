import { describe, expect, it } from 'vitest';
import { CLASSIC_STYLE, ERP_STYLE, ERP_V2_STYLE, MINIMAL_STYLE, MODERN_STYLE, MODERN_V2_STYLE, RETAIL_STYLE, isErpV2, isLegacyErp, isLegacyModern, isModernV2 } from './template-styles';

describe('أساليب قوالب المستندات الرسمية', () => {
  it('يفصل ERP وModern التاريخي وModern V2 وMinimal بهويات تركيبية مختلفة', () => {
    expect(ERP_STYLE.composition).toBe('erp');
    expect(MODERN_STYLE.composition).toBe('modern');
    expect(MODERN_V2_STYLE.composition).toBe('modern_v2');
    expect(MINIMAL_STYLE.composition).toBe('minimal');

    expect(ERP_STYLE.tableDensity).toBe('compact');
    expect(MODERN_STYLE.tableDensity).toBe('comfortable');
    expect(MINIMAL_STYLE.tableDensity).toBe('spacious');
    expect(new Set([ERP_STYLE.composition, ERP_V2_STYLE.composition, MODERN_STYLE.composition, MODERN_V2_STYLE.composition, MINIMAL_STYLE.composition]).size).toBe(5);
  });

  it('يبقي Modern التاريخي ببطاقات ناعمة وV2 رسمياً بلا بطاقات', () => {
    expect(MODERN_STYLE.cardRadius).toBe('rounded-md');
    expect(MODERN_STYLE.tableHead).toBe('soft');
    expect(MODERN_STYLE.pagePadding).toBe('p-10');
    expect(MODERN_V2_STYLE.cardRadius).toBe('rounded-none');
    expect(MODERN_V2_STYLE.cardRadius).not.toContain('rounded-2xl');
    expect(MODERN_V2_STYLE.tableHead).toBe('plain');
    expect(MODERN_V2_STYLE.brandBar).toBe(false);
    expect(ERP_STYLE.cardRadius).toBe('rounded-none');
    expect(MINIMAL_STYLE.cardRadius).toBe('rounded-none');
    expect(MINIMAL_STYLE.brandBar).toBe(false);
  });

  it('لا يغيّر توكنز Classic وERP وMinimal وRetail', () => {
    expect(CLASSIC_STYLE).toMatchObject({
      composition: 'classic',
      pagePadding: 'p-8',
      cardRadius: 'rounded-lg',
      sectionGap: 'mt-5',
      tableHead: 'brand',
      tableDensity: 'comfortable',
      brandBar: true,
    });
    expect(ERP_STYLE).toMatchObject({
      composition: 'erp',
      pagePadding: 'p-6',
      cardRadius: 'rounded-none',
      sectionGap: 'mt-4',
      tableHead: 'plain',
      tableDensity: 'compact',
      brandBar: true,
    });
    expect(MINIMAL_STYLE).toMatchObject({
      composition: 'minimal',
      pagePadding: 'p-12',
      cardRadius: 'rounded-none',
      sectionGap: 'mt-8',
      tableHead: 'plain',
      tableDensity: 'spacious',
      brandBar: false,
    });
    expect(RETAIL_STYLE).toMatchObject({
      composition: 'retail',
      pagePadding: 'p-6',
      cardRadius: 'rounded-md',
      sectionGap: 'mt-4',
      tableHead: 'brand',
      tableDensity: 'compact',
      brandBar: true,
    });
  });

  it('يميّز مساعدَي الهوية دون خلط التاريخي بـ V2', () => {
    expect(isLegacyModern(MODERN_STYLE)).toBe(true);
    expect(isModernV2(MODERN_STYLE)).toBe(false);
    expect(isModernV2(MODERN_V2_STYLE)).toBe(true);
    expect(isLegacyModern(MODERN_V2_STYLE)).toBe(false);
    expect(isLegacyModern(ERP_STYLE)).toBe(false);
    expect(isModernV2(MINIMAL_STYLE)).toBe(false);
    expect(isLegacyErp(ERP_STYLE)).toBe(true);
    expect(isErpV2(ERP_STYLE)).toBe(false);
    expect(isErpV2(ERP_V2_STYLE)).toBe(true);
    expect(isLegacyErp(ERP_V2_STYLE)).toBe(false);
    expect(ERP_V2_STYLE).toMatchObject({
      composition: 'erp_v2',
      pagePadding: 'p-5',
      cardRadius: 'rounded-none',
      sectionGap: 'mt-3',
      tableHead: 'plain',
      tableDensity: 'compact',
      brandBar: false,
    });
    expect(ERP_V2_STYLE.pagePadding).not.toBe(MODERN_V2_STYLE.pagePadding);
    expect(ERP_V2_STYLE.sectionGap).not.toBe(MODERN_V2_STYLE.sectionGap);
  });
});
