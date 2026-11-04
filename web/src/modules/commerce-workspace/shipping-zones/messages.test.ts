import { describe, expect, it } from 'vitest';
import { shippingZonesMessages } from './messages';

describe('shipping zones messages (COPS-H4-2)', () => {
  it('has identical, non-empty Arabic and English dictionaries', () => {
    const { ar, en } = shippingZonesMessages.messages;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const [key, value] of [...Object.entries(ar), ...Object.entries(en)]) {
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it('asks for SAR, never minor units, in the fee field', () => {
    expect(shippingZonesMessages.messages.ar.fieldRate).toContain('ريال');
    expect(shippingZonesMessages.messages.en.fieldRate).toContain('SAR');
  });
});
