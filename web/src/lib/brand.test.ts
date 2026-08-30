import { describe, expect, it } from 'vitest';
import { BRAND, getBrandName } from './brand';

describe('AWJ brand identity', () => {
  it('keeps the canonical Arabic and English product names', () => {
    expect(BRAND.name.ar).toBe('أَوْج');
    expect(BRAND.name.en).toBe('AWJ');
    expect(BRAND.displayName).toBe('أَوْج | AWJ');
  });

  it('returns AWJ for English and Arabic for all other locales', () => {
    expect(getBrandName('en')).toBe('AWJ');
    expect(getBrandName('ar')).toBe('أَوْج');
    expect(getBrandName('ar-SA')).toBe('أَوْج');
  });
});
