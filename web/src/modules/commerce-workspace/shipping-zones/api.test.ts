import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { createShippingZone, fetchShippingZones, mapShippingZone, mapShippingZones, updateShippingZone, zoneToPayload } from './api';

const raw = (over: Record<string, unknown> = {}) => ({ id: 'z1', name: 'الدمام', match_type: 'city', match_value: 'الدمام', rate_amount_minor: 1500, is_active: true, created_at: '2026-11-04T10:00:00+03:00', ...over });

describe('shipping zones api (COPS-H4-2)', () => {
  beforeEach(() => apiMock.mockReset());

  it('maps a server row and keeps minor units untouched', () => {
    expect(mapShippingZone(raw())).toEqual({ id: 'z1', name: 'الدمام', matchType: 'city', matchValue: 'الدمام', rateMinor: 1500, isActive: true });
  });

  it('drops malformed rows instead of inventing meaning, and never reads "active" without an explicit true', () => {
    expect(mapShippingZone(raw({ match_type: 'country' }))).toBeNull();
    expect(mapShippingZone(raw({ rate_amount_minor: '1500' }))).toBeNull();
    expect(mapShippingZone(raw({ rate_amount_minor: 15.5 }))).toBeNull();
    expect(mapShippingZone(raw({ id: 7 }))).toBeNull();
    expect(mapShippingZone(null)).toBeNull();
    expect(mapShippingZone(raw({ is_active: undefined }))?.isActive).toBe(false);
    expect(mapShippingZones({ data: [raw(), raw({ match_type: 'x' })] })).toHaveLength(1);
    expect(mapShippingZones({})).toEqual([]);
  });

  it('reads the list from the existing endpoint', async () => {
    apiMock.mockResolvedValue({ data: [raw()] });
    expect(await fetchShippingZones()).toHaveLength(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/shipping-zones');
  });

  it('creates with POST and updates with a full-body PUT to the zone id', async () => {
    apiMock.mockResolvedValue({ data: raw() });
    const body = { name: 'الدمام', match_type: 'city', match_value: 'الدمام', rate_amount_minor: 1500, is_active: true } as const;
    await createShippingZone(body);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/shipping-zones', { method: 'POST', body });
    await updateShippingZone('z 1/x', body);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/shipping-zones/z%201%2Fx', { method: 'PUT', body });
  });

  it('rejects an unrecognised write response instead of showing success', async () => {
    apiMock.mockResolvedValue({ data: { id: 'z1' } });
    await expect(createShippingZone({ name: 'x', match_type: 'city', match_value: 'x', rate_amount_minor: 0, is_active: true })).rejects.toThrow();
  });

  it('toggling a zone sends the current values with only is_active changed', () => {
    const zone = mapShippingZone(raw())!;
    expect(zoneToPayload(zone, { is_active: false })).toEqual({ name: 'الدمام', match_type: 'city', match_value: 'الدمام', rate_amount_minor: 1500, is_active: false });
  });
});
