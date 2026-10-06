import { describe, expect, it } from 'vitest';
import { FLOWERS_ADMIN_MESSAGES, flowersAdminMessage } from './messages';

describe('flowers admin messages', () => {
  it('covers every Arabic key in English and vice versa', () => {
    expect(Object.keys(FLOWERS_ADMIN_MESSAGES.en).sort()).toEqual(Object.keys(FLOWERS_ADMIN_MESSAGES.ar).sort());
  });

  it('uses the same {placeholders} in both locales', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(FLOWERS_ADMIN_MESSAGES.ar) as (keyof typeof FLOWERS_ADMIN_MESSAGES.ar)[]) {
      expect(placeholders(FLOWERS_ADMIN_MESSAGES.en[key]), key).toEqual(placeholders(FLOWERS_ADMIN_MESSAGES.ar[key]));
    }
  });

  it('interpolates variables and leaves unknown placeholders visible', () => {
    expect(flowersAdminMessage('en', 'giftSummaryLength', { n: 120 })).toBe('Card message up to 120 characters.');
    expect(flowersAdminMessage('ar', 'giftSummaryLength', { n: 120 })).toContain('120');
    expect(flowersAdminMessage('en', 'giftSummaryLength')).toContain('{n}');
  });

  it('defaults to Arabic unless the locale is English', () => {
    expect(flowersAdminMessage(undefined, 'save')).toBe('حفظ');
    expect(flowersAdminMessage('en-US', 'save')).toBe('Save');
  });
});
