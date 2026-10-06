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

/**
 * قائمة منسّقة بمعرّفات IANA **القانونية** (لا أسماء بديلة كـ`Asia/Calcutta`). لا نبني الخيارات من `Intl.supportedValuesOf`:
 * قائمة ICU في المتصفّح تختلف عن قائمة PHP التي يتحقق منها الخادم (`DateTimeZone::listIdentifiers`)، فكان يظهر خيارٌ
 * يرفضه الحفظ. كل معرّفٍ هنا مقبولٌ في PHP 8.x (يُتحقَّق منه في الاختبار بقائمة ثابتة معروفة). المنطقة المحفوظة حالياً
 * تبقى متاحةً دائماً حتى لو خرجت عن القائمة.
 */
export const WORLD_TIMEZONES = [
  'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Khartoum',
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Tripoli', 'Africa/Tunis',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/New_York', 'America/Sao_Paulo', 'America/Toronto',
  'Asia/Aden', 'Asia/Almaty', 'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Damascus', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tashkent',
  'Asia/Tehran', 'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris', 'Europe/Rome',
  'Pacific/Auckland', 'Pacific/Honolulu',
] as const;

export function allTimezones(): string[] {
  return [...WORLD_TIMEZONES];
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
