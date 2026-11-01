import { describe, expect, it } from 'vitest';
import { createIntentKeys } from './intent-key';

const counter = () => { let n = 0; return () => `k${++n}`; };

describe('createIntentKeys', () => {
  it('reuses the same key for a retry of the same payload', () => {
    const keys = createIntentKeys(counter());
    const payload = { amount_minor: 500, payment_method_id: 'm1' };
    expect(keys.keyFor(payload)).toBe('k1');
    expect(keys.keyFor({ ...payload })).toBe('k1');
  });

  it('issues a new key as soon as any field of the payload changes', () => {
    const keys = createIntentKeys(counter());
    expect(keys.keyFor({ amount_minor: 500 })).toBe('k1');
    expect(keys.keyFor({ amount_minor: 600 })).toBe('k2');
    expect(keys.keyFor({ amount_minor: 500 })).toBe('k3');
  });

  it('issues a fresh key after reset so two successive identical intents are independent', () => {
    const keys = createIntentKeys(counter());
    const payload = { type: 'cash_in', amount_minor: 100 };
    const first = keys.keyFor(payload);
    keys.reset();
    expect(keys.keyFor(payload)).not.toBe(first);
  });

  it('applies the optional prefix', () => {
    const keys = createIntentKeys(counter());
    expect(keys.keyFor({ a: 1 }, 'web-receipt-')).toBe('web-receipt-k1');
  });
});
