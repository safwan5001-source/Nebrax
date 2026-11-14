import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { classifyRejection, fillPath, findRecordedFill, getFill, isAllowedTankerReadPath, listFills, listOwners, listTankers, recordFill } from './client';
import type { FillBody, IntentPayload } from './logic';

const apiMock = vi.mocked(api);
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const body = (over: Partial<FillBody> = {}): FillBody => ({
  fuel_station_id: UID(1), fuel_nozzle_id: UID(2), fuel_tanker_owner_id: UID(3), fuel_shift_id: UID(4), voucher_number: '04052', quantity_milliliters: 2_000_000, idempotency_key: 'awj-ops-abc12345', ...over,
});

const fillRow = (over: Record<string, unknown> = {}) => ({
  id: UID(9), number: 'FTF-2027-00001', voucher_number: '04052', status: 'recorded', inventory_status: 'pending_integration', fuel_station_id: UID(1), fuel_shift_id: UID(4), fuel_pump_id: UID(5),
  fuel_nozzle_id: UID(2), fuel_tank_id: UID(6), fuel_product_id: UID(7), fuel_tanker_owner_id: UID(3), fuel_tanker_id: null, quantity_milliliters: 2_000_000, quantity_liters: '2000.000',
  recorded_at: '2027-01-26T09:00:00+03:00', ...over,
});

beforeEach(() => {
  apiMock.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('recordFill — honest outcomes and no auto-retry', () => {
  it('ok: a 201 with the fill; replay (200) is flagged', async () => {
    apiMock.mockResolvedValueOnce({ data: fillRow(), meta: { replayed: false } });
    const first = await recordFill(body());
    expect(first).toMatchObject({ kind: 'ok', replayed: false });
    apiMock.mockResolvedValueOnce({ data: fillRow(), meta: { replayed: true } });
    expect(await recordFill(body())).toMatchObject({ kind: 'ok', replayed: true });
  });

  it('sends exactly the body to the single POST path with an abort signal and the branch header (a request, not a permission)', async () => {
    apiMock.mockResolvedValueOnce({ data: fillRow() });
    await recordFill(body(), { branchId: 'br-1' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiMock.mock.calls[0] as [string, { method: string; body: unknown; signal: AbortSignal; headers?: Record<string, string> }];
    expect(path).toBe('/fuel-stations/tanker-fills');
    expect(init.method).toBe('POST');
    expect(init.body).toEqual(body());
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ 'X-Branch-Id': 'br-1' });
  });

  it('unverified: 2xx with an unintelligible body is neither success nor failure', async () => {
    apiMock.mockResolvedValueOnce({ data: { id: 5 } });
    expect(await recordFill(body())).toEqual({ kind: 'unverified' });
  });

  it.each([
    [422, { message: 'x', reason: 'voucher_invalid' }, 'voucher_invalid'],
    [422, { message: 'x', reason: 'shift_required' }, 'shift_required'],
    [422, { message: 'x', reason: 'capacity_overrun_confirmation_required' }, 'capacity_overrun_confirmation_required'],
    [409, { message: 'x', reason: 'voucher_duplicate' }, 'voucher_duplicate'],
    [409, { message: 'x', reason: 'idempotency_key_reused' }, 'idempotency_key_reused'],
    [409, { message: 'x' }, 'conflict'],
    [403, { message: 'x' }, 'forbidden'],
    [404, { message: 'x' }, 'not_found'],
    [401, { message: 'x' }, 'unauthorized'],
    [429, { message: 'x' }, 'rate_limited'],
    [422, { message: 'x', reason: 'something_new' }, 'validation'],
    [422, { message: 'x', errors: { quantity_liters: ['bad'] } }, 'validation'],
  ] as const)('rejected: %i %j ⇒ %s (4xx = no effect)', async (status, json, code) => {
    apiMock.mockRejectedValueOnce(new ApiError(status, 'رفض', json));
    expect(await recordFill(body())).toMatchObject({ kind: 'rejected', status, code });
  });

  it('only voucher_duplicate and unclassified rejections surface the server message', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(409, 'السند مسجَّل', { reason: 'voucher_duplicate' }));
    expect(await recordFill(body())).toMatchObject({ serverMessage: 'السند مسجَّل' });
  });

  it.each([[500], [502], [503]])('unknown: a %i after sending may have been applied', async (status) => {
    apiMock.mockRejectedValueOnce(new ApiError(status, 'boom', {}));
    expect(await recordFill(body())).toEqual({ kind: 'unknown', reason: 'server' });
  });

  it('unknown: a network error or an abort after sending (never a final failure)', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await recordFill(body())).toEqual({ kind: 'unknown', reason: 'network' });
    apiMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await recordFill(body())).toEqual({ kind: 'unknown', reason: 'timeout' });
  });

  it('not_sent: offline sends nothing at all', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await recordFill(body())).toEqual({ kind: 'not_sent', reason: 'offline' });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('never retries by itself, whatever the failure', async () => {
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await recordFill(body());
    await recordFill(body());
    expect(apiMock).toHaveBeenCalledTimes(2); // مرة لكل استدعاء صريح
  });

  it.each([
    [{ quantity_milliliters: 0 }], [{ quantity_milliliters: -1 }], [{ quantity_milliliters: 1.5 }], [{ quantity_milliliters: Number.NaN }], [{ voucher_number: '' }], [{ idempotency_key: 'short' }], [{ idempotency_key: 'x'.repeat(129) }],
  ])('refuses to send an invalid body %j', async (over) => {
    await expect(recordFill(body(over as Partial<FillBody>))).rejects.toThrow();
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('classifyRejection', () => {
  it('prefers the structured reason, then the HTTP status', () => {
    expect(classifyRejection(422, { reason: 'tanker_required' })).toBe('tanker_required');
    expect(classifyRejection(500, null)).toBe('validation');
    expect(classifyRejection(422, 'text')).toBe('validation');
  });
});

describe('reads — whitelist, validation and station scoping', () => {
  it('allows exactly the four PIN-reachable reads and nothing else', () => {
    for (const path of ['/fuel-stations/tanker-owners', '/fuel-stations/tankers', '/fuel-stations/tanker-fills', `/fuel-stations/tanker-fills/${UID(9)}`]) expect(isAllowedTankerReadPath(path), path).toBe(true);
    for (const path of [
      `/fuel-stations/tanker-owners/${UID(3)}`, `/fuel-stations/tanker-owners/${UID(3)}/company-links`, `/fuel-stations/tankers/${UID(1)}`, '/fuel-stations/tanker-fills/inventory-review', '/fuel-stations/tanker-fills/inventory-workspace',
      '/fuel-stations/tanker-fills/inventory-settings', `/fuel-stations/tanker-fills/${UID(9)}/inventory`, `/fuel-stations/tanker-fills/${UID(9)}/attachments`, `/fuel-stations/tanker-fills/${UID(9)}/inventory-posting/preview`,
      '/fuel-stations/tanker-fill-reports/fills', '/fuel-stations/tanker-fills/../shifts', '/fuel-stations/tanker-fills/x',
    ]) expect(isAllowedTankerReadPath(path), path).toBe(false);
  });

  it('fillPath validates the id (no path traversal)', () => {
    expect(fillPath(UID(9))).toBe(`/fuel-stations/tanker-fills/${UID(9)}`);
    expect(() => fillPath('../x')).toThrow();
    expect(() => fillPath('inventory-review')).toThrow();
  });

  it('listOwners asks only for active owners and drops anything else; flags truncation', async () => {
    apiMock.mockResolvedValueOnce({ data: [{ id: 'o1', name: 'عسكر', code: 'ASK', status: 'active' }, { id: 'o2', name: 'موقوف', code: null, status: 'suspended' }], meta: { current_page: 1, last_page: 3 } });
    const listing = await listOwners({ q: ' ع ' });
    expect(apiMock.mock.calls[0][0]).toBe('/fuel-stations/tanker-owners?status=active&q=%D8%B9');
    expect(listing.rows.map((o) => o.id)).toEqual(['o1']);
    expect(listing.truncated).toBe(true);
  });

  it('listTankers filters to the owner and active tankers only, and validates the owner id', async () => {
    apiMock.mockResolvedValueOnce({ data: [
      { id: 't1', fuel_tanker_owner_id: UID(3), plate_number: 'A', capacity_milliliters: 1000, status: 'active' },
      { id: 't2', fuel_tanker_owner_id: UID(3), plate_number: 'B', capacity_milliliters: null, status: 'inactive' },
      { id: 't3', fuel_tanker_owner_id: UID(8), plate_number: 'C', capacity_milliliters: null, status: 'active' },
    ] });
    const listing = await listTankers(UID(3));
    expect(listing.rows.map((t) => t.id)).toEqual(['t1']);
    expect(apiMock.mock.calls[0][0]).toBe(`/fuel-stations/tankers?owner_id=${UID(3)}&status=active`);
    await expect(listTankers('x')).rejects.toThrow();
  });

  it('listFills sends the station and shift filters and drops rows of other stations (defence in depth)', async () => {
    apiMock.mockResolvedValueOnce({ data: [fillRow(), fillRow({ id: UID(10), fuel_station_id: UID(99) })] });
    const listing = await listFills({ stationId: UID(1), shiftId: UID(4) });
    expect(apiMock.mock.calls[0][0]).toBe(`/fuel-stations/tanker-fills?station_id=${UID(1)}&shift_id=${UID(4)}&per_page=50`);
    expect(listing.rows).toHaveLength(1);
  });

  it('rejects an out-of-contract response entirely (never partial rows)', async () => {
    apiMock.mockResolvedValueOnce({ data: [fillRow({ quantity_milliliters: 'many' })] });
    await expect(listFills({ stationId: UID(1) })).rejects.toMatchObject({ kind: 'invalid_shape' });
  });

  it('getFill rejects a malformed id before any request', async () => {
    await expect(getFill('nope')).rejects.toMatchObject({ kind: 'not_found' });
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('findRecordedFill — "check status" is read-only and exact', () => {
  const payload: IntentPayload = { fuel_station_id: UID(1), fuel_nozzle_id: UID(2), fuel_tanker_owner_id: UID(3), fuel_shift_id: UID(4), voucher_number: '04052', quantity_milliliters: 2_000_000 };

  it('finds the matching recorded fill using GET only', async () => {
    apiMock.mockResolvedValueOnce({ data: [fillRow()] });
    expect(await findRecordedFill(payload)).toMatchObject({ number: 'FTF-2027-00001' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect((apiMock.mock.calls[0][1] as { method: string }).method).toBe('GET');
    expect(String(apiMock.mock.calls[0][0])).toContain('voucher_number=04052');
  });

  it.each([
    ['another quantity', { quantity_milliliters: 2_000_001 }], ['another nozzle', { fuel_nozzle_id: UID(77) }], ['another owner', { fuel_tanker_owner_id: UID(78) }],
    ['another shift', { fuel_shift_id: UID(79) }], ['a voided fill', { status: 'voided' }], ['another voucher (04052 vs 4052)', { voucher_number: '4052' }],
  ])('does not treat %s as the same attempt', async (_label, over) => {
    apiMock.mockResolvedValueOnce({ data: [fillRow(over)] });
    expect(await findRecordedFill(payload)).toBeNull();
  });
});
