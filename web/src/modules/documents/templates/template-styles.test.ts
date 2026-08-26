import { describe, expect, it } from 'vitest';
import { ERP_STYLE, MINIMAL_STYLE, MODERN_STYLE } from './template-styles';

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

  it('يبقي Modern رسمياً ويجعل Minimal طباعياً بلا زوايا زخرفية', () => {
    expect(MODERN_STYLE.cardRadius).toBe('rounded-md');
    expect(MODERN_STYLE.cardRadius).not.toContain('rounded-2xl');
    expect(ERP_STYLE.cardRadius).toBe('rounded-none');
    expect(MINIMAL_STYLE.cardRadius).toBe('rounded-none');
    expect(MINIMAL_STYLE.brandBar).toBe(false);
  });
});
