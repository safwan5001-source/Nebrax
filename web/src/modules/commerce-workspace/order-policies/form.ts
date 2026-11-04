/**
 * COPS-H4-5 (D-H4-07، خيار ب) — سياسات الطلب الإلكتروني على مستوى المؤسسة. **المفتاح الوحيد القابل للتحرير** هو `sales.commerce_payment_hold_minutes` (مدة حجز مخزون الطلب
 * الإلكتروني بانتظار الدفع، سياسة تشغيلية بلا أثر ضريبي). حدّاه يطابقان `CommercePaymentHold::MIN_MINUTES/MAX_MINUTES` في الخادم (15..1440).
 */
export const HOLD_MIN_MINUTES = 15;
export const HOLD_MAX_MINUTES = 1440;
export const HOLD_DEFAULT_MINUTES = 60;

export type HoldValidation = { ok: true; minutes: number } | { ok: false; error: 'required' | 'integer' | 'range' };

/** نصّ حقل الإدخال ← دقائق صحيحة ضمن الحدود. أرقام عربية-هندية تُقبل؛ لا كسور ولا إشارات ولا نص. */
export function validateHoldMinutes(input: string): HoldValidation {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (normalized === '') return { ok: false, error: 'required' };
  if (!/^\d+$/.test(normalized)) return { ok: false, error: 'integer' };
  const minutes = Number(normalized);
  if (!Number.isSafeInteger(minutes) || minutes < HOLD_MIN_MINUTES || minutes > HOLD_MAX_MINUTES) return { ok: false, error: 'range' };

  return { ok: true, minutes };
}
