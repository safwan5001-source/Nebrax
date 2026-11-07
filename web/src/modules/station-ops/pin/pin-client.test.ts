// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { UID, staff } from '../admin/__fixtures__';
import { clearStationPin, setStationPin } from './pin-client';

const apiMock = vi.mocked(api);
const ID = UID(7);
const ok = (extra: Record<string, unknown> = {}) => ({ data: { ...staff(ID, 'E'), station_pin: { has_pin: true, set_at: null }, ...extra } });

beforeEach(() => { apiMock.mockReset(); Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
afterEach(() => vi.useRealTimers());

describe('pin client', () => {
  it('rejects a non-uuid staff id before any request', async () => {
    await expect(setStationPin('../../invoices', {})).rejects.toThrow('invalid staff id');
    await expect(clearStationPin('abc')).rejects.toThrow('invalid staff id');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('returns the generated PIN once, only when it is exactly six digits', async () => {
    apiMock.mockResolvedValueOnce(ok({ generated_pin: '482915' }));
    expect(await setStationPin(ID, {})).toMatchObject({ kind: 'ok', generatedPin: '482915' });
    apiMock.mockResolvedValueOnce(ok({ generated_pin: 'not-a-pin' }));
    expect(await setStationPin(ID, {})).toEqual({ kind: 'unknown', reason: 'shape' });
  });

  it('classifies refusals without exposing details and never retries', async () => {
    for (const [status, code] of [[403, 'forbidden'], [404, 'not_found'], [422, 'validation'], [429, 'rate_limited'], [401, 'unauthorized']] as const) {
      apiMock.mockRejectedValueOnce(new ApiError(status, 'حدث خطأ', {}));
      expect(await setStationPin(ID, { pin: '482915' })).toMatchObject({ kind: 'rejected', status, code });
    }
    expect(apiMock).toHaveBeenCalledTimes(5);
  });

  it('treats 5xx, timeouts and network failures as unknown (the PIN may have been set)', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(502, 'x', {}));
    expect(await setStationPin(ID, {})).toEqual({ kind: 'unknown', reason: 'server' });
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await setStationPin(ID, {})).toEqual({ kind: 'unknown', reason: 'network' });
    apiMock.mockImplementationOnce((_p, options) => new Promise((_resolve, reject) => { (options as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))); }));
    expect(await setStationPin(ID, {}, { timeoutMs: 5 })).toEqual({ kind: 'unknown', reason: 'timeout' });
  });

  it('sends nothing when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await setStationPin(ID, {})).toEqual({ kind: 'not_sent', reason: 'offline' });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('omits empty fields from the body', async () => {
    apiMock.mockResolvedValue(ok());
    await setStationPin(ID, { pin: '', reason: '  ' });
    await clearStationPin(ID, { reason: ' why ' });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: {} });
    expect(apiMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE', body: { reason: 'why' } });
  });
});
