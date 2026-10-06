/**
 * FLOWERS-H2-3 — منطق مسوّدة نافذة التسليم (نقيّ وقابل للاختبار): التحويل بين النافذة المحفوظة ومسوّدة النموذج،
 * والتحقق المبكر الذي يعكس قيود الخادم. الخادم يبقى الحَكَم؛ أي رفضٍ منه يُعرض كما هو.
 */

import {
  MAX_LABEL_LENGTH,
  MAX_SLOTS,
  TIME_PATTERN,
  parseCapacity,
  slotRangeValid,
  type DeliveryMethod,
  type DeliverySlot,
} from './delivery-schedule';

export type SlotDraft = {
  method: DeliveryMethod;
  label: string;
  labelEn: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  capacity: string;
  shippingZoneId: string;
  isActive: boolean;
};

export type SlotErrors = Partial<Record<'label' | 'labelEn' | 'time' | 'weekdays' | 'capacity', 'required' | 'tooLong' | 'range' | 'format' | 'none' | 'invalid'>>;

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const emptySlotDraft = (method: DeliveryMethod = 'delivery'): SlotDraft => ({
  method,
  label: '',
  labelEn: '',
  startTime: '09:00',
  endTime: '12:00',
  weekdays: [...ALL_WEEKDAYS],
  capacity: '',
  shippingZoneId: '',
  isActive: true,
});

export const slotToDraft = (slot: DeliverySlot): SlotDraft => ({
  method: slot.method,
  label: slot.label,
  labelEn: slot.labelEn ?? '',
  startTime: slot.startTime,
  endTime: slot.endTime,
  weekdays: slot.weekdays.length > 0 ? [...slot.weekdays] : [...ALL_WEEKDAYS],
  capacity: slot.capacity === null ? '' : String(slot.capacity),
  shippingZoneId: slot.shippingZoneId ?? '',
  isActive: slot.isActive,
});

export function validateSlotDraft(draft: SlotDraft): SlotErrors {
  const errors: SlotErrors = {};
  const label = draft.label.trim();
  if (label === '') errors.label = 'required';
  else if (label.length > MAX_LABEL_LENGTH) errors.label = 'tooLong';
  if (draft.labelEn.trim().length > MAX_LABEL_LENGTH) errors.labelEn = 'tooLong';
  if (!TIME_PATTERN.test(draft.startTime) || !TIME_PATTERN.test(draft.endTime)) errors.time = 'format';
  else if (!slotRangeValid(draft.startTime, draft.endTime)) errors.time = 'range';
  if (draft.weekdays.length === 0) errors.weekdays = 'none';
  if (parseCapacity(draft.capacity) === undefined) errors.capacity = 'invalid';

  return errors;
}

export const hasErrors = (errors: SlotErrors): boolean => Object.keys(errors).length > 0;

/** يبني النافذة من مسوّدة صالحة. تقييد المنطقة للتوصيل فقط (الخادم يرفضه للاستلام). */
export function draftToSlot(draft: SlotDraft, id: string | null): DeliverySlot {
  const capacity = parseCapacity(draft.capacity);

  return {
    id,
    method: draft.method,
    label: draft.label.trim(),
    labelEn: draft.labelEn.trim() === '' ? null : draft.labelEn.trim(),
    startTime: draft.startTime,
    endTime: draft.endTime,
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    capacity: capacity === undefined ? null : capacity,
    shippingZoneId: draft.method === 'delivery' && draft.shippingZoneId !== '' ? draft.shippingZoneId : null,
    isActive: draft.isActive,
  };
}

export const canAddSlot = (slots: readonly DeliverySlot[]): boolean => slots.length < MAX_SLOTS;

/** تواريخ تفرّق بين مستندَين محمّلين: هل تغيّرت النوافذ على الخادم منذ فتحنا الصفحة؟ */
export function slotsSignature(slots: readonly DeliverySlot[]): string {
  return JSON.stringify(
    slots.map((s) => [s.id, s.method, s.label, s.labelEn, s.startTime, s.endTime, s.weekdays, s.capacity, s.shippingZoneId, s.isActive]),
  );
}

/**
 * ينقل نافذةً خطوةً واحدة **داخل مجموعة طريقتها** (التوصيل/الاستلام يُعرضان كمجموعتين). ترتيب العرض للمتسوّق
 * هو ترتيب المصفوفة المرسَلة (الخادم يكتبه `sort_order`)، فنبدّل موضع النافذة مع جارتها من النوع نفسه.
 */
export function moveWithinMethod(slots: readonly DeliverySlot[], index: number, direction: -1 | 1): DeliverySlot[] {
  const target = slots[index];
  if (!target) return [...slots];
  let swapWith = -1;
  for (let i = index + direction; i >= 0 && i < slots.length; i += direction) {
    if (slots[i].method === target.method) {
      swapWith = i;
      break;
    }
  }
  if (swapWith === -1) return [...slots];
  const next = [...slots];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];

  return next;
}
