// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import {
  WRITE_TIMEOUT_MS, classifyRejection, createOpeningDraft, docPath, getOpeningDoc, isAllowedOpeningReadPath, listOpeningDocs, postOpening, saveOpeningAccount, updateOpeningDraft,
} from './opening-client';

const apiMock = vi.mocked(api);
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (over: Record<string, unknown> = {}) => ({ id: UID(1), number: 'FOB-2026-00001', status: 'draft', station_id: 's1', opening_date: '2026-11-01', total_milliliters: 1000, lines: [], ...over });
const BODY = { opening_date: '2026-11-01', lines: [{ fuel_tank_id: 't1', quantity_liters: '1' }] };

beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); apiMock.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('read whitelist', () => {
  it('allows exactly the opening reads', () => {
    for (const path of ['/fuel-stations/opening-balances', `/fuel-stations/opening-balances/${UID(1)}`, `/fuel-stations/opening-balances/${UID(1)}/preview`, '/fuel-stations/settings', '/fuel-stations/stations/st-1/settings', '/accounts']) {
      expect(isAllowedOpeningReadPath(path), path).toBe(true);
    }
  });
  it('rejects traversal, other modules and malformed ids', () => {
    for (const path of ['/fuel-stations/opening-balances/..', '/fuel-stations/opening-balances/abc', `/fuel-stations/opening-balances/${UID(1)}/post`, '/fuel-stations/shifts', '/fuel-stations/deliveries', '/roles', '/users', '/journal-entries', '/fuel-stations/stations/a/b/settings']) {
      expect(isAllowedOpeningReadPath(path), path).toBe(false);
    }
    expect(() => docPath('../x')).toThrow();
  });
  it('rejects an out-of-shape response instead of rendering partial data', async () => {
    apiMock.mockResolvedValueOnce({ data: { id: 'x' } } as never);
    await expect(getOpeningDoc(UID(1))).rejects.toMatchObject({ kind: 'invalid_shape' });
  });
  it('maps a closed deployment gate (404) to not_found, sending the station filter only', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(404, 'x', {}));
    await expect(listOpeningDocs('s1')).rejects.toMatchObject({ kind: 'not_found' });
    expect(apiMock.mock.calls[0][0]).toBe('/fuel-stations/opening-balances?station_id=s1&per_page=50');
  });
});

describe('writes', () => {
  it('create: one POST with the idempotency key and the station, body untouched', async () => {
    apiMock.mockResolvedValueOnce({ data: doc(), meta: { replayed: false } } as never);
    const result = await createOpeningDraft('s1', BODY, 'key-1');
    expect(result).toMatchObject({ kind: 'ok', replayed: false });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toBe('/fuel-stations/opening-balances');
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: { fuel_station_id: 's1', idempotency_key: 'key-1', ...BODY } });
  });
  it('create: reports a replay from the server', async () => {
    apiMock.mockResolvedValueOnce({ data: doc(), meta: { replayed: true } } as never);
    expect(await createOpeningDraft('s1', BODY, 'key-1')).toMatchObject({ kind: 'ok', replayed: true });
  });
  it('update: PUT to the validated document path, no station or key in the body', async () => {
    apiMock.mockResolvedValueOnce({ data: doc() } as never);
    await updateOpeningDraft(UID(1), BODY);
    expect(apiMock.mock.calls[0][0]).toBe(`/fuel-stations/opening-balances/${UID(1)}`);
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: BODY });
  });
  it('post: POST /post with no body', async () => {
    apiMock.mockResolvedValueOnce({ data: doc({ status: 'posted' }) } as never);
    const result = await postOpening(UID(1));
    expect(result).toMatchObject({ kind: 'ok' });
    expect(apiMock.mock.calls[0][0]).toBe(`/fuel-stations/opening-balances/${UID(1)}/post`);
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect((apiMock.mock.calls[0][1] as { body?: unknown }).body).toBeUndefined();
  });
  it('refuses a malformed document id before any request', () => {
    expect(() => postOpening('../x')).rejects.toMatchObject({ kind: 'not_found' });
    expect(apiMock).not.toHaveBeenCalled();
  });
  it('account setting: sends exactly one key (never any other setting), to the station or the organization', async () => {
    apiMock.mockResolvedValue({ data: {} } as never);
    expect(await saveOpeningAccount({ kind: 'station', stationId: 'st-1' }, 'acc-1')).toEqual({ kind: 'ok' });
    await saveOpeningAccount({ kind: 'org' }, 'acc-2');
    expect(apiMock.mock.calls[0][0]).toBe('/fuel-stations/stations/st-1/settings');
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: { fuel_opening_balance_account_id: 'acc-1', reason: 'fuel_opening_balance_wizard' } });
    expect(Object.keys((apiMock.mock.calls[0][1] as { body: object }).body).sort()).toEqual(['fuel_opening_balance_account_id', 'reason']);
    expect(apiMock.mock.calls[1][0]).toBe('/fuel-stations/settings');
  });
  it('does not touch the network offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await postOpening(UID(1))).toEqual({ kind: 'not_sent', reason: 'offline' });
    expect(apiMock).not.toHaveBeenCalled();
  });
  it('an unconfirmed outcome is "unknown", never a rejection and never retried automatically', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(502, 'bad gateway', {}));
    expect(await postOpening(UID(1))).toEqual({ kind: 'unknown', reason: 'server' });
    apiMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await postOpening(UID(1))).toEqual({ kind: 'unknown', reason: 'network' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
  it('times out into "unknown"', async () => {
    vi.useFakeTimers();
    apiMock.mockImplementationOnce((_p, init) => new Promise((_resolve, reject) => { (init as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))); }) as never);
    const pending = postOpening(UID(1));
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ kind: 'unknown', reason: 'timeout' });
  });
  it('2xx with an unreadable body is "unverified"', async () => {
    apiMock.mockResolvedValueOnce({ nope: true } as never);
    expect(await postOpening(UID(1))).toEqual({ kind: 'unverified' });
  });
  it('carries the server blockers of a 422 opening_blocked rejection', async () => {
    const blockers = [{ code: 'FUEL_OPENING_POOL_NOT_EMPTY', message: 'm', fuel_product_id: 'p1' }, { code: 'FUEL_OPENING_COST_MISSING', message: 'c' }];
    apiMock.mockRejectedValueOnce(new ApiError(422, 'FUEL_OPENING_POOL_NOT_EMPTY: x', { reason: 'opening_blocked', message: 'x', blockers }));
    expect(await postOpening(UID(1))).toMatchObject({ kind: 'rejected', status: 422, code: 'blocked', blockers });
  });
  it('drops malformed blocker entries instead of inventing them', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'opening_blocked', blockers: [{ nope: 1 }, { code: 'A' }] }));
    const result = await postOpening(UID(1));
    expect(result).toMatchObject({ kind: 'rejected', blockers: [{ code: 'A' }] });
  });
});

describe('classifyRejection', () => {
  it.each([
    [401, 'x', 'unauthorized'], [403, 'x', 'forbidden'], [404, 'x', 'not_found'], [409, 'x', 'conflict'], [429, 'x', 'rate_limited'],
    [422, 'FUEL_OPENING_DATE_FUTURE: لا يُؤرَّخ', 'date_future'], [422, 'FUEL_OPENING_DATE_INVALID: x', 'date_invalid'], [422, 'FUEL_OPENING_QUANTITY_INVALID: x', 'quantity_invalid'],
    [422, 'FUEL_OPENING_COST_INVALID: x', 'cost_invalid'], [422, 'FUEL_OPENING_IDEMPOTENCY_CONFLICT: x', 'idempotency_conflict'], [422, 'FUEL_OPENING_NOT_DRAFT: x', 'not_draft'],
    [422, 'FUEL_OPENING_ACCOUNT_REQUIRED: x', 'account_required'], [422, 'FUEL_DISTINCT_APPROVER_REQUIRED: x', 'distinct_approver'], [422, 'FUEL_OPENING_BALANCE_MISMATCH: x', 'mismatch'],
    [422, 'تسجيل تكلفة الرصيد الافتتاحي للوقود يتطلب سلطة التكلفة المالية.', 'cost_authority'], [422, 'something else', 'validation'],
  ])('%i %s → %s', (status, message, code) => expect(classifyRejection(status, message)).toBe(code));
  it('uses the structured reason before the message', () => expect(classifyRejection(422, 'FUEL_OPENING_DATE_FUTURE', { reason: 'opening_blocked' })).toBe('blocked'));
});
