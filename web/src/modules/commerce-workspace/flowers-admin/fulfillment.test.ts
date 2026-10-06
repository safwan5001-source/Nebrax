import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { loadFulfillment, mapFulfillment, saveFulfillment } from './fulfillment';

afterEach(() => apiMock.mockReset());

const wh = (id: string, over: Record<string, unknown> = {}) => ({ id, code: `C-${id}`, name: `مخزن ${id}`, city: 'الدمام', is_active: true, ...over });
const body = (current: unknown, warehouses: unknown[]) => ({ data: { fulfillment: { warehouse: current }, warehouses } });

describe('fulfillment client', () => {
  it('maps the assigned warehouse and the picker list', () => {
    const doc = mapFulfillment(body(wh('a'), [wh('a'), wh('b', { is_active: false, city: null })]))!;
    expect(doc.current).toEqual({ id: 'a', code: 'C-a', name: 'مخزن a', city: 'الدمام', isActive: true });
    expect(doc.warehouses.map((w) => [w.id, w.isActive, w.city])).toEqual([['a', true, 'الدمام'], ['b', false, null]]);
  });

  it('treats an unassigned channel as null and rejects a malformed body', () => {
    expect(mapFulfillment(body(null, []))).toEqual({ current: null, warehouses: [] });
    expect(mapFulfillment({ data: { fulfillment: {} } })).toBeNull();
    expect(mapFulfillment(null)).toBeNull();
  });

  it('reads and writes through the store-scoped path sending only the warehouse id', async () => {
    apiMock.mockResolvedValue(body(wh('a'), [wh('a')]));
    await loadFulfillment('s1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/fulfillment');
    await saveFulfillment('s1', 'a');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/fulfillment', { method: 'PUT', body: { warehouse_id: 'a' } });
  });

  it('classifies a rejection with the server message', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'لا يمكن اختيار مخزن غير نشط لتنفيذ الطلبات.', {}));
    expect(await saveFulfillment('s1', 'x')).toMatchObject({ ok: false, kind: 'invalid', message: 'لا يمكن اختيار مخزن غير نشط لتنفيذ الطلبات.' });
  });
});
