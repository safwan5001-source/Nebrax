import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';
import { mapOperations } from './api';

/** COPS-H4-3 (UI) — في الوضع التجريبي تعمل الشاشة: القراءة تُقبل، والكتابة تحاكي الخادم (نسخة إلزامية، تعارض 409، تطبيق التغييرات فقط). */
describe('store operations in demo mode', () => {
  const path = '/commerce/channels/c1/operations-settings';

  it('reads a valid default view', async () => {
    const view = mapOperations(await mockApi(path));
    expect(view).toMatchObject({ version: 0, acceptingOrders: true, outsideHoursPolicy: 'accept', openingHours: [], minOrderMinor: null, minOrderScope: 'all' });
  });

  it('requires expected_version, refuses a stale one, applies only the sent keys and bumps the version once', async () => {
    await expect(mockApi(path, 'PUT', { accepting_orders: false })).rejects.toMatchObject({ status: 428 });
    await expect(mockApi(path, 'PUT', { expected_version: 9, accepting_orders: false })).rejects.toMatchObject({ status: 409, body: { reason: 'settings_version_conflict' } });
    const saved = mapOperations(await mockApi(path, 'PUT', { expected_version: 0, accepting_orders: false, pause_message: 'نعود قريباً' }));
    expect(saved).toMatchObject({ version: 1, acceptingOrders: false, pauseMessage: 'نعود قريباً', minOrderMinor: null });
    const same = mapOperations(await mockApi(path, 'PUT', { expected_version: 1, accepting_orders: false }));
    expect(same?.version).toBe(1);
    const hours = [{ weekday: 1, opens_at: '09:00', closes_at: '17:00' }];
    expect(mapOperations(await mockApi(path, 'PUT', { expected_version: 1, opening_hours: hours }))).toMatchObject({ version: 2, openingHours: hours });
    expect(mapOperations(await mockApi(path))?.acceptingOrders).toBe(false);
  });
});
