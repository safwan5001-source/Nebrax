// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { SAVE_TIMEOUT_MS, adminGet, isAllowedAdminReadPath, isValidStaffId, saveStaff, staffPath } from './admin-client';
import { UID, staff } from './__fixtures__';
import { staffListResponse } from './schemas';

const apiMock = vi.mocked(api);
beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); apiMock.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('read whitelist', () => {
  it('allows exactly the staff read endpoints and a uuid detail', () => {
    for (const path of ['/fuel-stations/staff', '/fuel-stations/staff/templates', '/fuel-stations/staff/candidates', '/fuel-stations/staff/audit', `/fuel-stations/staff/${UID(1)}`]) expect(isAllowedAdminReadPath(path), path).toBe(true);
  });
  it('rejects everything else before any request (traversal, other modules, malformed ids)', async () => {
    for (const path of ['/fuel-stations/staff/../shifts', '/fuel-stations/staff/not-a-uuid', '/fuel-stations/staff/x/y', '/roles', '/users', '/fuel-stations/shifts', '/fuel-stations/prices', `/fuel-stations/staff/${UID(1)}/extra`, '//fuel-stations/staff']) {
      expect(isAllowedAdminReadPath(path), path).toBe(false);
      await expect(adminGet(path, staffListResponse)).rejects.toThrow(/not an allowed read endpoint/);
    }
    expect(apiMock).not.toHaveBeenCalled();
    expect(isValidStaffId('abc')).toBe(false);
    expect(() => staffPath('../x')).toThrow();
  });
  it('rejects an out-of-shape response instead of rendering partial data', async () => {
    apiMock.mockResolvedValueOnce({ data: [{ user: { id: 'x' } }] } as never);
    await expect(adminGet('/fuel-stations/staff', staffListResponse)).rejects.toMatchObject({ kind: 'invalid_shape' });
  });
});

describe('the single write: PUT /fuel-stations/staff/{uuid}', () => {
  const body = { expected_revision: 'r1', add_permissions: ['fuel.reading.view'] };

  it('sends one PUT with the body untouched and never adds a caller-supplied path', async () => {
    const updated = staff(UID(1), 'Emp', { revision: 'r2' });
    apiMock.mockResolvedValueOnce({ data: updated } as never);
    const result = await saveStaff(UID(1), body);
    expect(result).toEqual({ kind: 'ok', staff: updated });
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiMock.mock.calls[0];
    expect(path).toBe(`/fuel-stations/staff/${UID(1)}`);
    expect(init).toMatchObject({ method: 'PUT', body });
  });

  it('refuses a malformed target before any request', async () => {
    await expect(saveStaff('../roles/1', body)).rejects.toMatchObject({ kind: 'not_found' });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, { message: 'no' }, 'forbidden'],
    [404, { message: 'x' }, 'not_found'],
    [422, { message: 'bad' }, 'validation'],
    [429, { message: 'slow' }, 'rate_limited'],
    [401, { message: 'auth' }, 'unauthorized'],
  ])('classifies %i as a final rejection with no automatic retry', async (status, payload, code) => {
    apiMock.mockRejectedValueOnce(new ApiError(status, payload.message, payload));
    const result = await saveStaff(UID(1), body);
    expect(result).toMatchObject({ kind: 'rejected', status, code });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a 409 staff_revision_conflict and surfaces the current revision', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(409, 'changed', { message: 'changed', reason: 'staff_revision_conflict', current_revision: 'r9' }));
    expect(await saveStaff(UID(1), body)).toMatchObject({ kind: 'rejected', code: 'revision_conflict', currentRevision: 'r9' });
    apiMock.mockRejectedValueOnce(new ApiError(409, 'other', { reason: 'something_else' }));
    expect(await saveStaff(UID(1), body)).toMatchObject({ kind: 'rejected', code: 'validation' }); // 409 غريب ≠ تعارض نسخة
  });

  it('treats 5xx and network loss after sending as UNKNOWN (it may have been applied), never as a failure to retry blindly', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503, 'down', {}));
    expect(await saveStaff(UID(1), body)).toEqual({ kind: 'unknown', reason: 'server' });
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await saveStaff(UID(1), body)).toEqual({ kind: 'unknown', reason: 'network' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('times out as unknown and aborts the request', async () => {
    vi.useFakeTimers();
    apiMock.mockImplementationOnce((_path, init) => new Promise((_resolve, reject) => { (init?.signal as AbortSignal).addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    const pending = saveStaff(UID(1), body);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ kind: 'unknown', reason: 'timeout' });
  });

  it('a 2xx with an unreadable body is unverified, not success', async () => {
    apiMock.mockResolvedValueOnce({ ok: true } as never);
    expect(await saveStaff(UID(1), body)).toEqual({ kind: 'unverified' });
  });

  it('offline sends nothing', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await saveStaff(UID(1), body)).toEqual({ kind: 'not_sent', reason: 'offline' });
    expect(apiMock).not.toHaveBeenCalled();
  });
});
