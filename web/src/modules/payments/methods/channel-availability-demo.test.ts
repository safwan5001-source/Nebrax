import { describe, expect, it } from 'vitest';
import { mockApi, mockPaymentMethods } from '@/lib/mock-data';
import { mapView } from './channel-availability';

/** COPS-H4-6 — في الوضع التجريبي يعمل قسم «الإتاحة حسب القناة»: القراءة تُقبل والكتابة تُطبَّق (بالذاكرة) وتُعاد النتيجة الفعلية. */
describe('channel availability in demo mode', () => {
  const method = mockPaymentMethods[0] as { id: string };

  it('lists the demo channels with the default state', async () => {
    const view = mapView(await mockApi(`/payment-methods/${method.id}/channel-availability`));
    expect(view?.channels.map((c) => c.type).sort()).toEqual(['mobile', 'web']);
    expect(view?.channels.every((c) => c.override === null)).toBe(true);
  });

  it('a PUT applies the override, resetting to null returns the default, and bad input is refused', async () => {
    const path = `/payment-methods/${method.id}/channel-availability/demo-channel-web`;
    const off = await mockApi<{ data: { override: boolean | null; effective: boolean } }>(path, 'PUT', { is_enabled: false });
    expect(off.data).toMatchObject({ override: false, effective: false });
    const read = mapView(await mockApi(`/payment-methods/${method.id}/channel-availability`));
    expect(read?.channels.find((c) => c.channelId === 'demo-channel-web')?.override).toBe(false);
    await mockApi(path, 'PUT', { is_enabled: null });
    const reset = mapView(await mockApi(`/payment-methods/${method.id}/channel-availability`));
    expect(reset?.channels.find((c) => c.channelId === 'demo-channel-web')?.override).toBeNull();
    await expect(mockApi(path, 'PUT', { is_enabled: 'yes' })).rejects.toMatchObject({ status: 422 });
    await expect(mockApi(`/payment-methods/nope/channel-availability`)).rejects.toMatchObject({ status: 404 });
  });
});
