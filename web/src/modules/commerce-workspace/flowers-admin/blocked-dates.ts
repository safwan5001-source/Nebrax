/**
 * FLOWERS-H2-4 — منطق التواريخ المحجوبة (نقيّ). التواريخ نصوص تقويمية `Y-m-d` بمنطقة القناة الزمنية: لا تمرّ
 * بـ`Date` المحلية للمتصفّح أبداً (فيما عدا حساب اسم اليوم من المكوّنات الرقمية بتوقيت UTC، وهو دالّة نقيّة
 * لا تتأثر بمنطقة الجهاز). «اليوم» في القناة يُشتقّ من منطقتها لا من منطقة الجهاز.
 */

import { MAX_BLOCKED_DATES, MAX_REASON_LENGTH, type BlockedDate, type BlockedMethod } from './delivery-schedule';
import { currentDateIn } from './timezones';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** هل النص تاريخٌ تقويمي حقيقي (فبراير 30 مرفوض)؟ */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));

  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** تاريخ اليوم `Y-m-d` في منطقة القناة (لا في منطقة الجهاز)؛ `null` إن لم تُفهم المنطقة. */
export const todayInZone = currentDateIn;

/** يوم الأسبوع (0 = الأحد) لتاريخ تقويمي، بلا أي تحويل منطقة. */
export function weekdayOfIso(value: string): number {
  const [y, m, d] = value.split('-').map(Number);

  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type BlockedGroups = { upcoming: BlockedDate[]; past: BlockedDate[] };

/** «اليوم» نفسه ضمن القادمة. الترتيب تصاعدي بالتاريخ ثم الطريقة. بلا `today` يُعدّ الكل قادماً. */
export function groupBlocked(rows: readonly BlockedDate[], today: string | null): BlockedGroups {
  const sorted = [...rows].sort((a, b) => (a.date === b.date ? a.method.localeCompare(b.method) : a.date.localeCompare(b.date)));
  if (today === null) return { upcoming: sorted, past: [] };

  return { upcoming: sorted.filter((r) => r.date >= today), past: sorted.filter((r) => r.date < today) };
}

export const sameBlocked = (a: Pick<BlockedDate, 'date' | 'method'>, b: Pick<BlockedDate, 'date' | 'method'>): boolean =>
  a.date === b.date && a.method === b.method;

export function blockedSignature(rows: readonly BlockedDate[]): string {
  return JSON.stringify([...rows].sort((a, b) => `${a.date}|${a.method}`.localeCompare(`${b.date}|${b.method}`)).map((r) => [r.date, r.method, r.reason]));
}

export type BlockedInputError = 'date_required' | 'date_invalid' | 'reason_too_long' | 'duplicate' | 'overlaps_all' | 'limit';

/**
 * يتحقق من إدخال حجبٍ جديد قبل الإرسال. الخادم يرفض تكرار (تاريخ+طريقة)؛ ونمنع أيضاً حجب طريقة محدّدة في
 * يومٍ محجوبٍ أصلاً لكل الطرق (لا معنى له) أو حجب «الكل» فوق حجبٍ جزئي قائم بدل استبداله بوضوح.
 */
export function validateBlockedInput(
  input: { date: string; method: BlockedMethod; reason: string },
  existing: readonly BlockedDate[],
): BlockedInputError | null {
  if (input.date.trim() === '') return 'date_required';
  if (!isRealIsoDate(input.date)) return 'date_invalid';
  if (input.reason.trim().length > MAX_REASON_LENGTH) return 'reason_too_long';
  if (existing.length >= MAX_BLOCKED_DATES) return 'limit';
  if (existing.some((row) => sameBlocked(row, input))) return 'duplicate';
  if (input.method !== 'all' && existing.some((row) => row.date === input.date && row.method === 'all')) return 'overlaps_all';

  return null;
}
