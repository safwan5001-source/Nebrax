import { describe, expect, it } from 'vitest';
import type { DeliverySlot } from './delivery-schedule';
import { draftToSlot, emptySlotDraft, hasErrors, moveWithinMethod, slotToDraft, slotsSignature, validateSlotDraft } from './slot-editor';

const slot = (over: Partial<DeliverySlot> = {}): DeliverySlot => ({
  id: 'a', method: 'delivery', label: 'صباحاً', labelEn: null, startTime: '09:00', endTime: '12:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shippingZoneId: null, isActive: true, ...over,
});

describe('slot editor', () => {
  it('starts from a sensible all-days delivery draft that is invalid until named', () => {
    const draft = emptySlotDraft();
    expect(draft).toMatchObject({ method: 'delivery', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: '', isActive: true });
    expect(validateSlotDraft(draft)).toEqual({ label: 'required' });
  });

  it('validates range, format, weekdays, capacity and lengths like the server', () => {
    const base = { ...emptySlotDraft(), label: 'x' };
    expect(hasErrors(validateSlotDraft(base))).toBe(false);
    expect(validateSlotDraft({ ...base, startTime: '12:00', endTime: '09:00' }).time).toBe('range');
    expect(validateSlotDraft({ ...base, startTime: '12:00', endTime: '12:00' }).time).toBe('range');
    expect(validateSlotDraft({ ...base, startTime: '', endTime: '12:00' }).time).toBe('format');
    expect(validateSlotDraft({ ...base, weekdays: [] }).weekdays).toBe('none');
    expect(validateSlotDraft({ ...base, capacity: '0' }).capacity).toBe('invalid');
    expect(validateSlotDraft({ ...base, capacity: '10001' }).capacity).toBe('invalid');
    expect(validateSlotDraft({ ...base, capacity: '' }).capacity).toBeUndefined();
    expect(validateSlotDraft({ ...base, label: 'x'.repeat(81) }).label).toBe('tooLong');
    expect(validateSlotDraft({ ...base, labelEn: 'x'.repeat(81) }).labelEn).toBe('tooLong');
  });

  it('round-trips a slot through a draft without changing it', () => {
    const original = slot({ labelEn: 'Morning', capacity: 12, weekdays: [1, 3], shippingZoneId: 'z1', isActive: false });
    expect(draftToSlot(slotToDraft(original), 'a')).toEqual(original);
  });

  it('drops the zone for pickup and trims text; empty capacity means unlimited', () => {
    const draft = { ...emptySlotDraft('pickup'), label: '  من الفرع  ', labelEn: '  ', shippingZoneId: 'z1', capacity: '' };
    expect(draftToSlot(draft, null)).toMatchObject({ id: null, method: 'pickup', label: 'من الفرع', labelEn: null, shippingZoneId: null, capacity: null });
  });

  it('moves a window only within its own method group', () => {
    const list = [slot({ id: 'd1' }), slot({ id: 'p1', method: 'pickup' }), slot({ id: 'd2' }), slot({ id: 'p2', method: 'pickup' })];
    expect(moveWithinMethod(list, 2, -1).map((s) => s.id)).toEqual(['d2', 'p1', 'd1', 'p2']);
    expect(moveWithinMethod(list, 0, -1).map((s) => s.id)).toEqual(['d1', 'p1', 'd2', 'p2']);
    expect(moveWithinMethod(list, 3, 1).map((s) => s.id)).toEqual(['d1', 'p1', 'd2', 'p2']);
    expect(moveWithinMethod(list, 1, 1).map((s) => s.id)).toEqual(['d1', 'p2', 'd2', 'p1']);
  });

  it('detects remote changes through a stable signature', () => {
    expect(slotsSignature([slot()])).toBe(slotsSignature([slot()]));
    expect(slotsSignature([slot()])).not.toBe(slotsSignature([slot({ capacity: 5 })]));
    expect(slotsSignature([slot()])).not.toBe(slotsSignature([]));
  });
});
