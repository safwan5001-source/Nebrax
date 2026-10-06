/**
 * أسماء الأيام (0 = الأحد) بلغة الواجهة وترتيب الأسبوع المألوف لها (السبت أولاً بالعربية، الأحد أولاً بالإنجليزية).
 * جداول ثابتة لا `Intl.DateTimeFormat`: اسم اليوم هنا ليس تنسيق تاريخ بل تسمية، وهي بذلك مستقلة عن التقويم/الأرقام
 * التي تتبدل بين المتصفحات (انظر حارس التنسيق المركزي).
 */

const AR_LONG = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;
const AR_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;
const EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayName(day: number, locale: string | undefined, style: 'short' | 'long' = 'short'): string {
  const index = ((Math.trunc(day) % 7) + 7) % 7;
  const english = locale?.startsWith('en');

  return (english ? (style === 'long' ? EN_LONG : EN_SHORT) : style === 'long' ? AR_LONG : AR_SHORT)[index];
}

export function weekdayOrder(locale: string | undefined): number[] {
  return locale?.startsWith('en') ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5];
}

/** «كل الأيام» أو أسماء الأيام المختارة بترتيب الأسبوع المحلي. */
export function summarizeWeekdays(days: readonly number[], locale: string | undefined, allLabel: string): string {
  if (days.length === 0 || days.length === 7) return allLabel;
  const set = new Set(days);
  const separator = locale?.startsWith('en') ? ', ' : '، ';

  return weekdayOrder(locale)
    .filter((day) => set.has(day))
    .map((day) => weekdayName(day, locale, 'short'))
    .join(separator);
}
