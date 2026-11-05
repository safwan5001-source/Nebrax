// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api, ApiError } from '@/lib/api';
import { shiftDetail } from './__fixtures__';
import { classifyRejection, opsWrite, type WriteRequest } from './write-client';
import { shouldClearIntentKey } from './write-outcome';

const apiMock = vi.mocked(api);
beforeEach(() => { apiMock.mockReset(); localStorage.clear(); Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
afterEach(() => vi.useRealTimers());

const SHIFT = '9f1c2d3e-0000-4000-8000-000000000001';

describe('opsWrite — whitelist and wire contract', () => {
  const cases: Array<[WriteRequest, string]> = [
    [{ action: 'open', body: { fuel_station_id: 'st', idempotency_key: 'k', opening_float_minor: 0 } }, '/fuel-stations/shifts/open'],
    [{ action: 'assign_staff', shiftId: SHIFT, body: { user_id: 'u', role: 'attendant' } }, `/fuel-stations/shifts/${SHIFT}/staff`],
    [{ action: 'meter_reading', shiftId: SHIFT, body: { fuel_nozzle_id: 'n', reading_stage: 'opening', meter_milliliters: 5, evidence_key: 'e' } }, `/fuel-stations/shifts/${SHIFT}/meter-readings`],
    [{ action: 'tank_reading', shiftId: SHIFT, body: { fuel_tank_id: 't', reading_stage: 'closing', reading_type: 'physical', quantity_milliliters: 5, evidence_key: 'e' } }, `/fuel-stations/shifts/${SHIFT}/tank-readings`],
    [{ action: 'cash_movement', shiftId: SHIFT, body: { type: 'cash_in', amount_minor: 100, reason: 'abc', idempotency_key: 'k' } }, `/fuel-stations/shifts/${SHIFT}/cash-movements`],
    [{ action: 'close', shiftId: SHIFT, body: { counted_cash_minor: 100 } }, `/fuel-stations/shifts/${SHIFT}/close`],
  ];

  it.each(cases)('%j → POST %s with the branch header and a bounded abort signal', async (request, path) => {
    apiMock.mockResolvedValue({ data: shiftDetail('s', 'a') });
    const result = await opsWrite(request, { branchId: 'branch-1' });
    expect(result.kind).toBe('ok');
    const [url, options] = apiMock.mock.calls[0];
    expect(url).toBe(path);
    expect(options).toMatchObject({ method: 'POST', body: request.body, headers: { 'X-Branch-Id': 'branch-1' } });
    expect((options as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a path-injecting shift id and non-integer / negative amounts BEFORE any request', async () => {
    await expect(opsWrite({ action: 'close', shiftId: '../sales', body: { counted_cash_minor: 1 } })).rejects.toThrow(/invalid shift id/);
    await expect(opsWrite({ action: 'close', shiftId: 'open', body: { counted_cash_minor: 1 } })).rejects.toThrow(/invalid shift id/);
    await expect(opsWrite({ action: 'close', shiftId: SHIFT, body: { counted_cash_minor: 1.5 } })).rejects.toThrow(/integers/);
    await expect(opsWrite({ action: 'close', shiftId: SHIFT, body: { counted_cash_minor: -1 } })).rejects.toThrow(/integers/);
    await expect(opsWrite({ action: 'meter_reading', shiftId: SHIFT, body: { fuel_nozzle_id: 'n', reading_stage: 'opening', meter_milliliters: Number.NaN, evidence_key: 'e' } })).rejects.toThrow(/integers/);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('sends nothing while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await opsWrite(cases[5][0])).toEqual({ kind: 'not_sent', reason: 'offline' });
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('opsWrite — honest outcomes', () => {
  const request: WriteRequest = { action: 'close', shiftId: SHIFT, body: { counted_cash_minor: 100 } };

  it('2xx with an unreadable body is NOT shown as success', async () => {
    apiMock.mockResolvedValue({ data: { weird: true } });
    expect(await opsWrite(request)).toEqual({ kind: 'unverified' });
  });
  it('4xx = rejected with the server message and a stable code (no effect happened)', async () => {
    apiMock.mockRejectedValue(new ApiError(422, 'الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.', {}));
    expect(await opsWrite(request)).toEqual({ kind: 'rejected', status: 422, code: 'shift_not_open', serverMessage: 'الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.' });
    apiMock.mockRejectedValue(new ApiError(403, 'حدث خطأ', {}));
    expect(await opsWrite(request)).toMatchObject({ kind: 'rejected', status: 403, code: 'forbidden', serverMessage: null });
  });
  it('5xx / network failure / timeout AFTER sending = unknown (the write may have happened)', async () => {
    apiMock.mockRejectedValue(new ApiError(503, 'x', {}));
    expect(await opsWrite(request)).toEqual({ kind: 'unknown', reason: 'server' });
    apiMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await opsWrite(request)).toEqual({ kind: 'unknown', reason: 'network' });
  });
  it('aborts after the timeout and reports unknown (never blindly retried)', async () => {
    vi.useFakeTimers();
    apiMock.mockImplementation((_path, options) => new Promise((_resolve, reject) => {
      (options as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = opsWrite(request, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await pending).toEqual({ kind: 'unknown', reason: 'timeout' });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe('classifyRejection — real server messages (FuelShiftService)', () => {
  it.each([
    [422, 'توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.', 'shift_already_open'],
    [422, 'سياسة المحطة تتطلب تسجيل float نقدي افتتاحي صريح، ولو كانت قيمته صفراً.', 'float_required'],
    [422, 'مفتاح منع التكرار استُخدم سابقاً لوردية محطة أخرى.', 'idempotency_conflict'],
    [422, 'محطة الشفت لا تخص الفرع النشط.', 'station_branch'],
    [422, 'لا يمكن تشغيل شفت على محطة غير نشطة.', 'station_inactive'],
    [422, 'الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.', 'shift_not_open'],
    [422, 'قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.', 'reading_exists'],
    [422, 'قراءة الخزان لهذه المرحلة مسجلة بالفعل ولا يعاد استخدامها.', 'reading_exists'],
    [422, 'مفتاح دليل قراءة العداد استُخدم سابقاً لسجل مختلف.', 'evidence_conflict'],
    [422, 'الفوهة لا تنتمي إلى المحطة أو الفرع النشطين، أو ليست متاحة تشغيلياً.', 'asset_unavailable'],
    [422, 'العامل مسند بالفعل إلى هذا الشفت.', 'staff_already_assigned'],
    [422, 'لا يمكن إخراج أو تسجيل مصروف نقدي يتجاوز الرصيد التشغيلي المتوقع للشفت.', 'cash_exceeds_balance'],
    [422, 'قراءة إغلاق العداد لا تكون أقل من قراءة الفتح لنفس الفوهة.', 'closing_below_opening'],
    [422, 'سياسة المحطة تتطلب قراءات ختامية للخزانات لكل أصول المحطة النشطة قبل إغلاق الشفت.', 'close_needs_readings'],
    [422, 'سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.', 'close_needs_staff'],
    [422, 'سياسة المحطة تمنع إغلاق الشفت قبل حل فرق النقد التشغيلي.', 'close_blocked_cash_variance'],
    [422, 'سياسة المحطة تمنع إغلاق الشفت مع فرق خزان تشغيلي خارج التفاوت المعتمد.', 'close_blocked_tank_variance'],
    [422, 'نوع قراءة فتح وإغلاق الخزان يجب أن يبقى متطابقاً داخل الشفت.', 'tank_type_mismatch'],
    [422, 'The given data was invalid.', 'validation'],
    [401, undefined, 'unauthorized'], [403, undefined, 'forbidden'], [404, undefined, 'not_found'], [409, undefined, 'conflict'], [429, undefined, 'rate_limited'],
  ])('%i %s → %s', (status, message, code) => {
    expect(classifyRejection(status, message)).toBe(code);
  });
});

describe('shouldClearIntentKey', () => {
  const rejected = { kind: 'rejected', status: 422, code: 'validation', serverMessage: null } as const;
  it('frees the key only for a definitive rejection or an unsent request that was NOT preceded by an uncertain attempt', () => {
    expect(shouldClearIntentKey(rejected, false)).toBe(true);
    expect(shouldClearIntentKey({ kind: 'not_sent', reason: 'offline' }, false)).toBe(true);
    expect(shouldClearIntentKey(rejected, true)).toBe(false);
    expect(shouldClearIntentKey({ kind: 'not_sent', reason: 'offline' }, true)).toBe(false);
    expect(shouldClearIntentKey({ kind: 'unknown', reason: 'timeout' }, false)).toBe(false);
    expect(shouldClearIntentKey({ kind: 'unverified' }, false)).toBe(false);
  });
});
