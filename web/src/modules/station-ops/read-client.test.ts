// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api, ApiError } from '@/lib/api';
import { StationOpsError, isAllowedReadPath, opsGet, toStationOpsError } from './read-client';
import { stationsResponse } from './schemas';

const apiMock = vi.mocked(api);
const listSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

beforeEach(() => { apiMock.mockReset(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('opsGet — read-only client', () => {
  it('only allows the documented GET endpoints', () => {
    for (const ok of ['stations', 'products', 'pumps', 'nozzles', 'tanks', 'prices', 'shifts']) {
      expect(isAllowedReadPath(`/fuel-stations/${ok}`)).toBe(true);
    }
    // قراءة وردية بمعرّفها (UI-1) مسموحة؛ أما `open` (مسار POST) وما يتجاوز المعرّف إلى مسار فرعي أو `../` فلا.
    for (const good of ['/fuel-stations/shifts/9f1c2d3e-0000-4000-8000-000000000001', '/fuel-stations/shifts/s1']) expect(isAllowedReadPath(good), good).toBe(true);
    for (const bad of ['/fuel-stations/shifts/open', '/fuel-stations/shifts/abc/close', '/fuel-stations/shifts/abc/meter-readings', '/fuel-stations/shifts/../sales', '/fuel-stations/shifts/%2e%2e', '/fuel-stations/shifts/a b', '/fuel-stations/shifts/', '/fuel-stations/sales', '/fuel-stations/stations/1/settings', '/login', '/fuel-stations/deliveries', '/fuel-stations/stations/abc']) {
      expect(isAllowedReadPath(bad), bad).toBe(false);
    }
  });

  it('rejects a non-allowed path before any request', async () => {
    await expect(opsGet('/fuel-stations/sales', listSchema)).rejects.toThrow(/not an allowed read endpoint/);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('always issues GET through the shared api() (same token, branch header and 401 handling)', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'x' }] });
    await opsGet('/fuel-stations/shifts', listSchema, { query: { station_id: 's1', status: 'open', page: 2, skipped: undefined } });
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [url, options] = apiMock.mock.calls[0];
    expect(url).toBe('/fuel-stations/shifts?station_id=s1&status=open&page=2');
    expect(options).toMatchObject({ method: 'GET' });
    expect(options).not.toHaveProperty('body');
  });

  it('sends X-Branch-Id only when a branch override is given', async () => {
    apiMock.mockResolvedValue({ data: [] });
    await opsGet('/fuel-stations/shifts', listSchema, { branchId: 'branch-9' });
    await opsGet('/fuel-stations/shifts', listSchema, { branchId: null });
    await opsGet('/fuel-stations/shifts', listSchema);
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { 'X-Branch-Id': 'branch-9' } });
    expect(apiMock.mock.calls[1][1]).not.toHaveProperty('headers');
    expect(apiMock.mock.calls[2][1]).not.toHaveProperty('headers');
  });

  it('classifies HTTP failures honestly', async () => {
    const cases: Array<[number, string]> = [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [500, 'server'], [503, 'server']];
    for (const [status, kind] of cases) {
      apiMock.mockRejectedValueOnce(new ApiError(status, 'x', {}));
      await expect(opsGet('/fuel-stations/tanks', listSchema)).rejects.toMatchObject({ kind, status });
    }
  });

  it('classifies a network failure as offline', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(opsGet('/fuel-stations/tanks', listSchema)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('lets AbortError through untouched so callers can ignore it', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    apiMock.mockRejectedValueOnce(abort);
    await expect(opsGet('/fuel-stations/tanks', listSchema)).rejects.toBe(abort);
  });

  it('rejects a response whose shape does not match (never renders partial data)', async () => {
    apiMock.mockResolvedValueOnce({ data: [{ id: 'a', code: 'C', name: 'N' }] }); // الحالة مفقودة
    await expect(opsGet('/fuel-stations/stations', stationsResponse)).rejects.toMatchObject({ kind: 'invalid_shape' });
    apiMock.mockResolvedValueOnce({ items: [] });
    await expect(opsGet('/fuel-stations/stations', stationsResponse)).rejects.toMatchObject({ kind: 'invalid_shape' });
    apiMock.mockResolvedValueOnce(null);
    await expect(opsGet('/fuel-stations/stations', stationsResponse)).rejects.toMatchObject({ kind: 'invalid_shape' });
  });

  it('never calls the API in preview (demo) mode and says so', async () => {
    localStorage.setItem('demo', 'true');
    await expect(opsGet('/fuel-stations/stations', stationsResponse)).rejects.toMatchObject({ kind: 'demo' });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('toStationOpsError keeps an existing classification', () => {
    const existing = new StationOpsError('forbidden', 403);
    expect(toStationOpsError(existing)).toBe(existing);
  });
});
