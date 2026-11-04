import { describe, expect, it } from 'vitest';
import { orderPoliciesMessages } from './messages';

describe('order policies messages (COPS-H4-5)', () => {
  it('has identical, non-empty Arabic and English dictionaries', () => {
    const { ar, en } = orderPoliciesMessages.messages;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const [key, value] of [...Object.entries(ar), ...Object.entries(en)]) expect(value.length, key).toBeGreaterThan(0);
  });
});
