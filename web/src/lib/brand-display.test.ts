import { describe, expect, it } from 'vitest';
import { BRAND, getBrandName } from './brand';

const LEGACY_DISPLAY_NAMES = ['نبراكس', 'نبراس', 'Nebrax', 'NEBRAX', 'Nibras', 'NIBRAS'];

describe('AWJ customer-facing identity', () => {
  it('uses only the canonical Arabic and English display names', () => {
    expect(BRAND.name).toEqual({ ar: 'أَوْج', en: 'AWJ' });
    expect(BRAND.displayName).toBe('أَوْج | AWJ');
  });

  it('does not expose a legacy product name through the brand helper', () => {
    const displayValues = [BRAND.displayName, getBrandName('ar'), getBrandName('en')];

    for (const legacyName of LEGACY_DISPLAY_NAMES) {
      expect(displayValues.some((value) => value.includes(legacyName))).toBe(false);
    }
  });
});
