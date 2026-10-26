import { describe, expect, it } from 'vitest';
import { COMMERCE_ORDERS_MESSAGES, ordersMessages } from './messages';

describe('orders messages', () => {
  it('covers every Arabic key in English and vice versa', () => {
    expect(Object.keys(COMMERCE_ORDERS_MESSAGES.en).sort()).toEqual(Object.keys(COMMERCE_ORDERS_MESSAGES.ar).sort());
  });

  it('never leaves a message empty', () => {
    for (const dict of Object.values(COMMERCE_ORDERS_MESSAGES)) {
      for (const value of Object.values(dict)) expect((value as string).trim()).not.toBe('');
    }
  });

  it('shows unknown server values verbatim and a dash for empty', () => {
    const { label } = ordersMessages('ar');
    expect(label('payment', 'future_state')).toBe('future_state');
    expect(label('payment', null)).toBe('—');
    expect(label('payment', 'collected')).toBe('تم التحصيل');
  });

  it('does not describe collected as an accounting posting', () => {
    const ar = COMMERCE_ORDERS_MESSAGES.ar['payment.collected'];
    expect(ar).not.toMatch(/ترحيل|قيد|فاتورة/);
    expect(COMMERCE_ORDERS_MESSAGES.ar.accountingWarningBody).toMatch(/ليست إثباتاً لقيد/);
  });
});
