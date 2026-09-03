import { isNegative, isValidRiyal, riyalToMinor } from '@/lib/money';

/**
 * عقد فتح جلسة POS من الواجهة الحديثة.
 *
 * الطلب إلى `POST /pos-sessions/open` يبقى مطابقاً للـ backend:
 * `opening_balance` هللات صحيحة ≥ 0 (الصفر صالح)، و`pos_device_id` إلزامي،
 * و`pos_shift_id` لوردية نقاط البيع لا وردية HR.
 *
 * تصفية الأجهزة/الورديات غير النشطة هنا UX فقط — الخادم يبقى مصدر الحقيقة
 * لعزل المستأجر/الفرع ورفض الجهاز أو الوردية المعطّلين.
 */
export interface PosSessionOpenInput {
  openingBalanceRiyal: string | number;
  posDeviceId: string;
  posShiftId: string;
}

export interface PosSessionOpenPayload {
  opening_balance: number;
  pos_device_id: string;
  pos_shift_id: string;
}

export type PosOpenSessionFieldError = 'device_required' | 'shift_required' | 'opening_balance_invalid';

export type PosOpenSessionParseResult =
  | { ok: true; payload: PosSessionOpenPayload }
  | { ok: false; error: PosOpenSessionFieldError };

export function findMyOpenSession<T extends { status: string }>(sessions: T[]): T | null {
  return sessions.find((session) => session.status === 'open') ?? null;
}

/** UX فقط: يخفي الخيارات المعطّلة من القائمة. الخادم ما زال يرفضها عند الفتح. */
export function selectableActiveRecords<T extends { is_active: boolean }>(items: T[]): T[] {
  return items.filter((item) => item.is_active);
}

export function buildPosSessionOpenPayload(input: PosSessionOpenInput): PosOpenSessionParseResult {
  if (!input.posDeviceId.trim()) return { ok: false, error: 'device_required' };
  if (!input.posShiftId.trim()) return { ok: false, error: 'shift_required' };

  // القبول كصفحة الجلسات: isValidRiyal && !isNegative — الصفر و'' يُطبَّعان إلى 0.
  // ممنوع فحص `if (!opening_balance)` بعد التحويل لأن الصفر falsy في JS.
  if (!isValidRiyal(input.openingBalanceRiyal) || isNegative(input.openingBalanceRiyal)) {
    return { ok: false, error: 'opening_balance_invalid' };
  }
  const openingBalance = riyalToMinor(input.openingBalanceRiyal);

  return {
    ok: true,
    payload: {
      opening_balance: openingBalance,
      pos_device_id: input.posDeviceId,
      pos_shift_id: input.posShiftId,
    },
  };
}

export function canSubmitPosSessionOpen(input: PosSessionOpenInput, busy: boolean): boolean {
  return !busy && buildPosSessionOpenPayload(input).ok;
}
