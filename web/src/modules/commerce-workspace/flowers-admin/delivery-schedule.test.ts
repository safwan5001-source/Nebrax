import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  leadTimeToMinutes,
  loadSchedule,
  mapScheduleDocument,
  parseCapacity,
  parseDaysAhead,
  saveBlockedDates,
  saveSettings,
  saveSlots,
  settingsEqual,
  slotRangeValid,
  splitLeadTime,
} from './delivery-schedule';

afterEach(() => apiMock.mockReset());

const document = (over: Record<string, unknown> = {}) => ({
  data: {
    settings: { enabled: true, required: false, timezone: 'Asia/Riyadh', lead_time_minutes: 120, cutoff_time: '15:30', max_days_ahead: 14 },
    slots: [
      { id: 'a1', method: 'delivery', label: 'صباحاً', label_en: 'Morning', start_time: '09:00', end_time: '12:00', weekdays: [5, 0, 1], capacity: 20, shipping_zone_id: null, sort_order: 0, is_active: true },
      { id: 'a2', method: 'pickup', label: 'من الفرع', label_en: null, start_time: '10:00', end_time: '20:00', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shipping_zone_id: null, sort_order: 1, is_active: false },
    ],
    blocked_dates: [{ date: '2026-12-25', method: 'all', reason: 'عطلة' }, { date: '2026-12-26', method: 'pickup', reason: null }],
    ...over,
  },
});

describe('delivery schedule client', () => {
  it('maps settings, slots (weekdays sorted) and blocked dates', () => {
    const doc = mapScheduleDocument(document())!;
    expect(doc.settings).toEqual({ enabled: true, required: false, timezone: 'Asia/Riyadh', leadTimeMinutes: 120, cutoffTime: '15:30', maxDaysAhead: 14 });
    expect(doc.slots[0]).toMatchObject({ id: 'a1', method: 'delivery', label: 'صباحاً', labelEn: 'Morning', weekdays: [0, 1, 5], capacity: 20, isActive: true });
    expect(doc.slots[1]).toMatchObject({ method: 'pickup', capacity: null, labelEn: null, isActive: false });
    expect(doc.blockedDates).toEqual([
      { date: '2026-12-25', method: 'all', reason: 'عطلة' },
      { date: '2026-12-26', method: 'pickup', reason: null },
    ]);
  });

  it('drops malformed rows instead of inventing values and rejects a malformed document', () => {
    const doc = mapScheduleDocument(
      document({ slots: [{ id: 'x', method: 'teleport', label: 'x', start_time: '09:00', end_time: '10:00' }, null], blocked_dates: [{ date: 'tomorrow' }] }),
    )!;
    expect(doc.slots).toEqual([]);
    expect(doc.blockedDates).toEqual([]);
    expect(mapScheduleDocument({ data: { settings: { enabled: true } } })).toBeNull();
    expect(mapScheduleDocument(null)).toBeNull();
  });

  it('ignores an invalid cutoff instead of showing garbage', () => {
    const doc = mapScheduleDocument(document({ settings: { enabled: true, timezone: 'Asia/Riyadh', cutoff_time: '25:99' } }))!;
    expect(doc.settings.cutoffTime).toBeNull();
  });

  it('splits and rebuilds lead time without loss', () => {
    expect(splitLeadTime(0)).toEqual({ value: 0, unit: 'hours' });
    expect(splitLeadTime(90)).toEqual({ value: 90, unit: 'minutes' });
    expect(splitLeadTime(120)).toEqual({ value: 2, unit: 'hours' });
    expect(splitLeadTime(2880)).toEqual({ value: 2, unit: 'days' });
    for (const minutes of [0, 15, 60, 90, 1440, 43200]) {
      const { value, unit } = splitLeadTime(minutes);
      expect(leadTimeToMinutes(String(value), unit)).toBe(minutes);
    }
  });

  it('bounds lead time, days ahead and capacity like the server', () => {
    expect(leadTimeToMinutes('30', 'days')).toBe(43200);
    expect(leadTimeToMinutes('31', 'days')).toBeNull();
    expect(leadTimeToMinutes('-1', 'hours')).toBeNull();
    expect(leadTimeToMinutes('1.5', 'hours')).toBeNull();
    expect(leadTimeToMinutes('', 'hours')).toBeNull();
    expect(parseDaysAhead('1')).toBe(1);
    expect(parseDaysAhead('90')).toBe(90);
    expect(parseDaysAhead('0')).toBeNull();
    expect(parseDaysAhead('91')).toBeNull();
    expect(parseCapacity('')).toBeNull();
    expect(parseCapacity('25')).toBe(25);
    expect(parseCapacity('0')).toBeUndefined();
    expect(parseCapacity('10001')).toBeUndefined();
    expect(parseCapacity('x')).toBeUndefined();
  });

  it('requires a window to end after it starts on the same day', () => {
    expect(slotRangeValid('09:00', '12:00')).toBe(true);
    expect(slotRangeValid('12:00', '12:00')).toBe(false);
    expect(slotRangeValid('18:00', '09:00')).toBe(false);
    expect(slotRangeValid('9:00', '12:00')).toBe(false);
    expect(slotRangeValid('', '12:00')).toBe(false);
  });

  it('compares settings field by field', () => {
    const a = mapScheduleDocument(document())!.settings;
    expect(settingsEqual(a, { ...a })).toBe(true);
    expect(settingsEqual(a, { ...a, cutoffTime: null })).toBe(false);
  });

  it('reads and writes through the store-scoped paths with the API field names', async () => {
    apiMock.mockResolvedValue(document());
    await loadSchedule('s1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/delivery-schedule');

    const doc = mapScheduleDocument(document())!;
    await saveSettings('s1', doc.settings);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/delivery-schedule/settings', {
      method: 'PUT',
      body: { is_enabled: true, is_required: false, timezone: 'Asia/Riyadh', lead_time_minutes: 120, cutoff_time: '15:30', max_days_ahead: 14 },
    });
  });

  it('sends every slot (the server deletes what is omitted), keeping ids and omitting the id of new ones', async () => {
    apiMock.mockResolvedValue(document());
    const doc = mapScheduleDocument(document())!;
    await saveSlots('s1', [doc.slots[0], { ...doc.slots[1], id: null, label: '  مساءً ', labelEn: '   ' }]);
    const body = (apiMock.mock.calls.at(-1)![1] as { body: { slots: Record<string, unknown>[] } }).body;
    expect(body.slots).toHaveLength(2);
    expect(body.slots[0]).toMatchObject({ id: 'a1', method: 'delivery', start_time: '09:00', end_time: '12:00', weekdays: [0, 1, 5], capacity: 20, is_active: true });
    expect('id' in body.slots[1]).toBe(false);
    expect(body.slots[1]).toMatchObject({ label: 'مساءً', label_en: null, capacity: null, is_active: false });
  });

  it('sends blocked dates as plain Y-m-d strings (never converted through Date)', async () => {
    apiMock.mockResolvedValue(document());
    await saveBlockedDates('s1', [{ date: '2026-12-25', method: 'all', reason: ' عطلة ' }, { date: '2026-12-26', method: 'pickup', reason: '' }]);
    expect(apiMock.mock.calls.at(-1)![1]).toEqual({
      method: 'PUT',
      body: { blocked_dates: [{ date: '2026-12-25', method: 'all', reason: 'عطلة' }, { date: '2026-12-26', method: 'pickup', reason: null }] },
    });
  });

  it('classifies a validation rejection with the server message', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'وقت نهاية النافذة يجب أن يلي بدايتها في اليوم نفسه.', {}));
    expect(await saveSlots('s1', [])).toMatchObject({ ok: false, kind: 'invalid', message: 'وقت نهاية النافذة يجب أن يلي بدايتها في اليوم نفسه.' });
  });
});
