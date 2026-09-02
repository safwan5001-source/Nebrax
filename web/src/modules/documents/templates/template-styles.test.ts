import { describe, expect, it } from 'vitest';
import { CLASSIC_STYLE, ERP_STYLE, MINIMAL_STYLE, MODERN_STYLE, RETAIL_STYLE } from './template-styles';

describe('أساليب قوالب المستندات الرسمية', () => {
  it('يفصل ERP وModern وMinimal بهويات تركيبية وكثافات مختلفة', () => {
    expect(ERP_STYLE.composition).toBe('erp');
    expect(MODERN_STYLE.composition).toBe('modern');
    expect(MINIMAL_STYLE.composition).toBe('minimal');

    expect(ERP_STYLE.tableDensity).toBe('compact');
    expect(MODERN_STYLE.tableDensity).toBe('comfortable');
    expect(MINIMAL_STYLE.tableDensity).toBe('spacious');
    expect(new Set([ERP_STYLE.composition, MODERN_STYLE.composition, MINIMAL_STYLE.composition]).size).toBe(3);
  });

  it('يبقي Modern رسمياً بلا بطاقات ويجعل Minimal طباعياً بلا زوايا زخرفية', () => {
    expect(MODERN_STYLE.cardRadius).toBe('rounded-none');
    expect(MODERN_STYLE.cardRadius).not.toContain('rounded-2xl');
    expect(MODERN_STYLE.tableHead).toBe('plain');
    expect(MODERN_STYLE.brandBar).toBe(false);
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
});
