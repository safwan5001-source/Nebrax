import type { StationSettings } from './schemas';

/**
 * UI-2 — سياسة الوردية كما تُقرأ من إعدادات المحطة (لا تُخمَّن ولا تُنسخ).
 *
 * `known = false` (فشل القراءة/غياب مفتاح) ⇒ نفترض **الصارم**: نطلب عهدة افتتاح صريحة ونعرض قراءات الخزانات مطلوبة. لكن غير المعروف
 * لا **يحجب** شيئاً من جهة العميل (الخادم هو السلطة): نحجب فقط ما تثبت أنه مطلوب. هذه الدالة لا تفرض سياسة — تعرض ما يفرضه الخادم.
 */
export interface ShiftPolicy {
  /** كل المفاتيح وردت من الخادم؛ وإلا يُعرض تنبيه «تعذّر قراءة سياسة المحطة». */
  known: boolean;
  openingFloatRequired: boolean;
  openingMeterRequired: boolean;
  closingMeterRequired: boolean;
  openingTankRequired: boolean;
  closingTankRequired: boolean;
  staffMandatory: boolean;
  /** `null` = غير معروف (لا نَعِد بالسماح بالإغلاق مع فرق نقد ولا نمنعه — الخادم يحكم). */
  allowCloseWithCashVariance: boolean | null;
  /** `true` ⇒ الاعتماد من مشرف مختلف عن فاتح الوردية (الخادم يفرضه)؛ `null` = غير معروف (لا حجب محلي). */
  supervisorApprovalRequired: boolean | null;
}

export const STRICT_POLICY: ShiftPolicy = {
  known: false,
  openingFloatRequired: true,
  openingMeterRequired: true,
  closingMeterRequired: true,
  openingTankRequired: true,
  closingTankRequired: true,
  staffMandatory: true,
  allowCloseWithCashVariance: null,
  supervisorApprovalRequired: null,
};

export function toShiftPolicy(settings: StationSettings): ShiftPolicy {
  const pick = (value: boolean | undefined, fallback: boolean) => value ?? fallback;
  const complete = [
    settings.shift_opening_meter_reading_required,
    settings.shift_closing_meter_reading_required,
    settings.shift_opening_tank_reading_required,
    settings.shift_closing_tank_reading_required,
    settings.shift_opening_cash_float_required,
    settings.shift_mandatory_staff_assignment,
  ].every((value) => typeof value === 'boolean');
  return {
    known: complete,
    openingFloatRequired: pick(settings.shift_opening_cash_float_required, true),
    openingMeterRequired: pick(settings.shift_opening_meter_reading_required, true),
    closingMeterRequired: pick(settings.shift_closing_meter_reading_required, true),
    openingTankRequired: pick(settings.shift_opening_tank_reading_required, true),
    closingTankRequired: pick(settings.shift_closing_tank_reading_required, true),
    staffMandatory: pick(settings.shift_mandatory_staff_assignment, true),
    allowCloseWithCashVariance: settings.shift_allow_close_with_pending_cash_variance ?? null,
    supervisorApprovalRequired: settings.shift_supervisor_approval_required ?? null,
  };
}
