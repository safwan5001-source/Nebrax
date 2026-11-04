import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { fetchOrderPolicies, mapOrderPolicies, saveHoldMinutes } from './api';

const payload = (over: Record<string, unknown> = {}) => ({
  data: { commerce_payment_hold_minutes: 60, commerce_invoice_trigger: 'none', commerce_price_tax_mode: null, commerce_partner_policy: 'link_verified_else_create', other: 1, ...over },
});

describe('order policies api (COPS-H4-5)', () => {
  beforeEach(() => apiMock.mockReset());

  it('maps the four policy keys and defaults the unknown ones safely', () => {
    expect(mapOrderPolicies(payload())).toEqual({ holdMinutes: 60, invoiceTrigger: 'none', priceTaxMode: null, partnerPolicy: 'link_verified_else_create' });
    expect(mapOrderPolicies(payload({ commerce_price_tax_mode: 'inclusive', commerce_invoice_trigger: 'on_payment_confirmed', commerce_partner_policy: 'manual_link' }))).toEqual({
      holdMinutes: 60, invoiceTrigger: 'on_payment_confirmed', priceTaxMode: 'inclusive', partnerPolicy: 'manual_link',
    });
    expect(mapOrderPolicies({ data: { commerce_payment_hold_minutes: 45 } })).toEqual({ holdMinutes: 45, invoiceTrigger: 'none', priceTaxMode: null, partnerPolicy: 'link_verified_else_create' });
  });

  it('rejects a payload without an integer hold time', () => {
    expect(mapOrderPolicies({})).toBeNull();
    expect(mapOrderPolicies(payload({ commerce_payment_hold_minutes: '60' }))).toBeNull();
    expect(mapOrderPolicies(payload({ commerce_payment_hold_minutes: 60.5 }))).toBeNull();
  });

  it('reads GET /sales-settings and throws on an unrecognised response', async () => {
    apiMock.mockResolvedValueOnce(payload());
    expect((await fetchOrderPolicies()).holdMinutes).toBe(60);
    expect(apiMock).toHaveBeenCalledWith('/sales-settings');
    apiMock.mockResolvedValueOnce({ data: {} });
    await expect(fetchOrderPolicies()).rejects.toThrow();
  });

  it('writes exactly ONE key: commerce_payment_hold_minutes', async () => {
    apiMock.mockResolvedValueOnce(payload({ commerce_payment_hold_minutes: 120 }));
    const saved = await saveHoldMinutes(120);
    expect(saved.holdMinutes).toBe(120);
    expect(apiMock).toHaveBeenCalledWith('/sales-settings', { method: 'PUT', body: { commerce_payment_hold_minutes: 120 } });
    expect(Object.keys((apiMock.mock.calls[0][1] as { body: object }).body)).toEqual(['commerce_payment_hold_minutes']);
  });
});
