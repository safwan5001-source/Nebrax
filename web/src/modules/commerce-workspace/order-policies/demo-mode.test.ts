import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';
import { mapOrderPolicies } from './api';

/** COPS-H4-5 (Codex P2) — في الوضع التجريبي تعمل الشاشة: القراءة تُقبل والكتابة تُطبَّق وحدودها كالخادم. */
describe('order policies in demo mode', () => {
  it('the demo sales settings carry the four policy keys and map cleanly', async () => {
    const policies = mapOrderPolicies(await mockApi('/sales-settings'));
    expect(policies).toEqual({ holdMinutes: 60, invoiceTrigger: 'none', priceTaxMode: null, partnerPolicy: 'link_verified_else_create' });
  });

  it('a PUT applies the submitted duration (only that key) and a later read returns it', async () => {
    const saved = mapOrderPolicies(await mockApi('/sales-settings', 'PUT', { commerce_payment_hold_minutes: 120 }));
    expect(saved?.holdMinutes).toBe(120);
    expect(mapOrderPolicies(await mockApi('/sales-settings'))?.holdMinutes).toBe(120);
    expect(saved?.invoiceTrigger).toBe('none');
    await mockApi('/sales-settings', 'PUT', { commerce_payment_hold_minutes: 60 });
  });

  it.each([5, 1441, 30.5, '60'])('rejects the invalid duration %j with 422 like the server', async (minutes) => {
    await expect(mockApi('/sales-settings', 'PUT', { commerce_payment_hold_minutes: minutes })).rejects.toMatchObject({ status: 422 });
    expect(mapOrderPolicies(await mockApi('/sales-settings'))?.holdMinutes).toBe(60);
  });
});
