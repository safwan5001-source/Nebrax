import { describe, expect, it } from 'vitest';
import { storeOperationsMessages } from './messages';

describe('store operations messages (COPS-H4-3 UI)', () => {
  it('has identical, non-empty Arabic and English dictionaries', () => {
    const { ar, en } = storeOperationsMessages.messages;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const [key, value] of [...Object.entries(ar), ...Object.entries(en)]) expect(value.length, key).toBeGreaterThan(0);
  });
});
