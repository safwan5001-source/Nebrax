import { isValidRiyal, riyalToMinor } from '@/lib/money';
import type { ShiftDetail } from './schemas';

/**
 * UI-2 — حسابات النقد التشغيلي للوردية (دوال نقية، أعداد صحيحة بالهللات).
 *
 * المعادلة نسخةٌ حرفية من `FuelShiftService::close`: المتوقع = عهدة الافتتاح + إيداعات − سحوبات − مصروفات (حركات الوردية وحدها).
 * **لا تدخل مبيعات الوقود** (CYCLE_4 §4). هذه معاينة محلية للمستخدم قبل التأكيد؛ الرقم النهائي يحسبه الخادم عند الإغلاق ويُعرض من رده.
 */

export type MinorParse = { ok: true; minor: number } | { ok: false; reason: 'empty' | 'invalid' };

/** مبلغ بالريال من حقل نص ⇒ هللات صحيحة. الفراغ **ليس صفراً** (لا افتراض)، والسالب والمشوّه مرفوضان. */
export function parseMoney(raw: string, options: { min: number } = { min: 0 }): MinorParse {
  if (raw.trim() === '') return { ok: false, reason: 'empty' };
  if (!isValidRiyal(raw)) return { ok: false, reason: 'invalid' };
  const minor = riyalToMinor(raw);
  if (!Number.isSafeInteger(minor) || minor < options.min) return { ok: false, reason: 'invalid' };
  return { ok: true, minor };
}

export interface CashTotals {
  cashIn: number;
  cashOut: number;
  expenses: number;
  /** عهدة الافتتاح + إيداعات − سحوبات − مصروفات. */
  expected: number;
}

/** `null` = لا نعرف الحركات (الخادم لم يعدها) أو فيها نوع غير معروف — لا نعرض متوقعاً مخترعاً. */
export function cashTotals(detail: Pick<ShiftDetail, 'opening_float_minor' | 'cash_movements'>): CashTotals | null {
  const movements = detail.cash_movements;
  if (movements === undefined) return null;
  let cashIn = 0;
  let cashOut = 0;
  let expenses = 0;
  for (const movement of movements) {
    if (movement.type === 'cash_in') cashIn += movement.amount_minor;
    else if (movement.type === 'cash_out') cashOut += movement.amount_minor;
    else if (movement.type === 'expense') expenses += movement.amount_minor;
    else return null;
  }
  return { cashIn, cashOut, expenses, expected: detail.opening_float_minor + cashIn - cashOut - expenses };
}

export type VarianceDirection = 'none' | 'overage' | 'shortage';

export interface ClosePreview {
  expected: number;
  counted: number;
  variance: number;
  direction: VarianceDirection;
}

export function closePreview(totals: CashTotals, countedMinor: number): ClosePreview {
  const variance = countedMinor - totals.expected;
  return { expected: totals.expected, counted: countedMinor, variance, direction: variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage' };
}

export type MovementType = 'cash_in' | 'cash_out' | 'expense';
export const MOVEMENT_TYPES: readonly MovementType[] = ['cash_in', 'cash_out', 'expense'];

/** يطابق قاعدة الخادم: سحب/مصروف لا يتجاوز النقد التشغيلي المتوقع. `null` = مسموح (أو لا نعرف فيحكم الخادم). */
export function movementBlocker(totals: CashTotals | null, type: MovementType, amountMinor: number): 'exceeds_balance' | null {
  if (totals === null || type === 'cash_in') return null;
  return amountMinor > totals.expected ? 'exceeds_balance' : null;
}

export const MIN_REASON_LENGTH = 3;
export function isValidReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REASON_LENGTH && trimmed.length <= 2000;
}
