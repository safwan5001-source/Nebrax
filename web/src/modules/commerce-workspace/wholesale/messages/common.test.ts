import { describe, expect, it } from 'vitest';
import { WHOLESALE_SECTION_KEYS } from '../nav';
import { commonMessages } from './common';
import { interpolate } from './factory';
import { expectMessageParity } from './testing';

describe('wholesale common messages', () => {
  it('has identical keys, no empty values and matching placeholders in ar/en', () => {
    expectMessageParity(commonMessages.messages);
  });

  it('names every section in both languages', () => {
    for (const locale of ['ar', 'en']) {
      const { t } = commonMessages.forLocale(locale);
      for (const key of WHOLESALE_SECTION_KEYS) expect(t(`section.${key}` as 'section.overview')).not.toMatch(/^section\./);
    }
  });

  it('interpolates placeholders and leaves unknown ones intact', () => {
    expect(interpolate('Price list: {name}', { name: 'A' })).toBe('Price list: A');
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });

  it('shows unknown server values verbatim and a dash for empty', () => {
    const { label } = commonMessages.forLocale('en');
    expect(label('section', 'future')).toBe('future');
    expect(label('section', null)).toBe('—');
    expect(label('section', 'orders')).toBe('Wholesale orders');
  });
});
