/**
 * مناطق زمنية للمتجر: قائمة منسّقة للأسواق الشائعة أولاً ثم بقية معرّفات IANA. القيمة المخزَّنة دائماً معرّف
 * IANA كما يقبله الخادم (`DateTimeZone::listIdentifiers`)؛ الاسم المعروض تجميليّ فقط. معرّفٌ لا يقبله الخادم
 * يعود برفضٍ صريح (422) ولا يُخفى.
 */

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

/** «GMT+3» لمنطقة؛ فارغ إن لم تُدعم. */
export function zoneOffsetLabel(timeZone: string, locale: string | undefined, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat(locale?.startsWith('en') ? 'en-GB' : 'en-GB', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');

    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** اسم مقروء: «Riyadh (GMT+3)» — المدينة من المعرّف نفسه فتتطابق مع ما يعرفه التاجر من لوحات الشحن. */
export function zoneLabel(timeZone: string, locale: string | undefined, at: Date = new Date()): string {
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
  const offset = zoneOffsetLabel(timeZone, locale, at);

  return offset ? `${city} (${offset})` : city;
}

/** الساعة الحالية بصيغة HH:mm في المنطقة (أرقام لاتينية، 24 ساعة)؛ `null` إن كانت المنطقة غير مفهومة للمتصفّح. */
export function currentTimeIn(timeZone: string, at: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  } catch {
    return null;
  }
}
