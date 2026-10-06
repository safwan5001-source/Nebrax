/**
 * مناطق زمنية للمتجر: قائمة منسّقة للأسواق الشائعة أولاً ثم بقية معرّفات IANA. القيمة المخزَّنة دائماً معرّف
 * IANA كما يقبله الخادم (`DateTimeZone::listIdentifiers`)؛ الاسم المعروض تجميليّ فقط. معرّفٌ لا يقبله الخادم
 * يعود برفضٍ صريح (422) ولا يُخفى.
 */

import { safeTimeZone, timeZoneOffsetLabel, utcIsoToZonedWallTime } from '@/lib/timezone';

export const COMMON_TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Baghdad',
  'Asia/Amman',
  'Asia/Beirut',
  'Africa/Cairo',
  'Europe/Istanbul',
  'UTC',
] as const;

export function allTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) return supported;
  } catch {
    // بيئة بلا دعم: نسقط على القائمة المنسّقة.
  }

  return [...COMMON_TIMEZONES];
}

export type TimezoneGroups = { common: string[]; other: string[] };

/** يضمن حضور المنطقة المحفوظة حالياً حتى لو خرجت عن القوائم، فلا يُعرض اختيارٌ فارغ يوحي بقيمة أخرى. */
export function timezoneGroups(current: string): TimezoneGroups {
  const common: string[] = [...COMMON_TIMEZONES];
  const commonSet = new Set<string>(common);
  const other = allTimezones().filter((zone) => !commonSet.has(zone));
  if (current && !commonSet.has(current) && !other.includes(current)) other.unshift(current);

  return { common, other };
}

/** «Riyadh (GMT+03:00)»: المدينة من المعرّف نفسه فتتطابق مع ما يعرفه التاجر من لوحات الشحن. */
export function zoneLabel(timeZone: string): string {
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');

  return `${city} (${timeZoneOffsetLabel(timeZone)})`;
}

/** معرّف IANA يفهمه المتصفّح؟ (`safeTimeZone` يسقط على الافتراضي لغير المفهوم، فلا نقبل ذلك السقوط الصامت هنا). */
export const isKnownZone = (timeZone: string): boolean => safeTimeZone(timeZone) === timeZone.trim();

/** الساعة الحالية `HH:mm` في المنطقة (24 ساعة، أرقام لاتينية)؛ `null` إن لم يفهم المتصفّح المنطقة. */
export function currentTimeIn(timeZone: string, at: Date = new Date()): string | null {
  return isKnownZone(timeZone) ? (utcIsoToZonedWallTime(at.toISOString(), timeZone)?.time ?? null) : null;
}

/** تاريخ اليوم `YYYY-MM-DD` في المنطقة (لا في منطقة الجهاز)؛ `null` إن لم تُفهم. */
export function currentDateIn(timeZone: string, at: Date = new Date()): string | null {
  return isKnownZone(timeZone) ? (utcIsoToZonedWallTime(at.toISOString(), timeZone)?.date ?? null) : null;
}
