import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));

import { acknowledgeOrder } from './acknowledge-order';

describe('acknowledgeOrder (COPS-H3-4)', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('POST بلا جسم إلى مسار الإقرار ويعيد created', async () => {
    apiMock.mockResolvedValue({ data: { created: true } });
    await expect(acknowledgeOrder('o 1/2')).resolves.toEqual({ ok: true, created: true });
    expect(apiMock).toHaveBeenCalledWith('/commerce/orders/o%201%2F2/acknowledge', { method: 'POST' });
  });

  it('متكرر (created=false) نجاح', async () => {
    apiMock.mockResolvedValue({ data: { created: false } });
    await expect(acknowledgeOrder('o')).resolves.toEqual({ ok: true, created: false });
  });

  it.each([404, 409, 422])('رفض %s مستقر (settled) مع رمز السبب', async (status) => {
    apiMock.mockRejectedValue(new ApiError(status, 'x', { reason: 'already_cancelled' }));
    await expect(acknowledgeOrder('o')).resolves.toEqual({ ok: false, settled: true, status, reason: 'already_cancelled' });
  });

  it.each([403, 500, 503])('%s فشل عابر/غير مستقر', async (status) => {
    apiMock.mockRejectedValue(new ApiError(status, 'x', {}));
    await expect(acknowledgeOrder('o')).resolves.toEqual({ ok: false, settled: false, status, reason: null });
  });

  it('خطأ شبكة (غير ApiError) غير مستقر بلا حالة', async () => {
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(acknowledgeOrder('o')).resolves.toEqual({ ok: false, settled: false, status: null, reason: null });
  });
});
