import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { fetchOperations, mapOperations, saveOperations } from './api';

const payload = (over: Record<string, unknown> = {}) => ({
  data: {
    version: 2, accepting_orders: false, paused_until: '2026-11-09T10:00:00Z', pause_message: 'نعود قريباً', outside_hours_policy: 'block',
    opening_hours: [{ weekday: 1, opens_at: '09:00', closes_at: '17:00' }, { bad: true }], min_order_minor: 15000, min_order_scope: 'delivery_only', intake_controls_deployment_enabled: true, ...over,
  },
});

describe('store operations api (COPS-H4-3 UI)', () => {
  beforeEach(() => apiMock.mockReset());

  it('maps the contract, dropping malformed periods', () => {
    expect(mapOperations(payload())).toEqual({
      version: 2, acceptingOrders: false, pausedUntil: '2026-11-09T10:00:00Z', pauseMessage: 'نعود قريباً', outsideHoursPolicy: 'block',
      openingHours: [{ weekday: 1, opens_at: '09:00', closes_at: '17:00' }], minOrderMinor: 15000, minOrderScope: 'delivery_only', deploymentEnabled: true,
    });
  });

  it('never reads the gate as open unless the server says true; rejects unknown enums', () => {
    expect(mapOperations(payload({ intake_controls_deployment_enabled: undefined }))?.deploymentEnabled).toBe(false);
    expect(mapOperations(payload({ outside_hours_policy: 'maybe' }))).toBeNull();
    expect(mapOperations(payload({ min_order_scope: 'x' }))).toBeNull();
    expect(mapOperations(payload({ min_order_minor: '15000' }))).toBeNull();
    expect(mapOperations(payload({ accepting_orders: 'no' }))).toBeNull();
    expect(mapOperations({})).toBeNull();
  });

  it('reads and writes the existing endpoint with expected_version and only the changed keys', async () => {
    apiMock.mockResolvedValueOnce(payload());
    await fetchOperations('ch 1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/channels/ch%201/operations-settings');
    apiMock.mockResolvedValueOnce(payload({ version: 3 }));
    const saved = await saveOperations('ch1', 2, { accepting_orders: true, paused_until: null });
    expect(saved.version).toBe(3);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/channels/ch1/operations-settings', { method: 'PUT', body: { expected_version: 2, accepting_orders: true, paused_until: null } });
  });

  it('throws on an unrecognised response instead of pretending success', async () => {
    apiMock.mockResolvedValueOnce({ data: {} });
    await expect(saveOperations('ch1', 0, { accepting_orders: false })).rejects.toThrow();
  });
});
