import { utcIsoToZonedWallTime } from '@/lib/timezone';
import type { ReportFilters } from './client';

/** مساعدات التواريخ للمرشحات. التواريخ سلاسل Y-m-d بتوقيت منطقة معطاة (منطقة المحطة، لا منطقة المتصفح). */

export function todayIn(timezone: string, now: Date = new Date()): string {
  return utcIsoToZonedWallTime(now.toISOString(), timezone)?.date ?? now.toISOString().slice(0, 10); // مساعد المناطق المركزي (حارس تنسيق التواريخ)
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export type PresetId = 'today' | 'yesterday' | 'last7' | 'month' | 'lastMonth';

export function presetRange(id: PresetId, timezone: string, now: Date = new Date()): { from: string; to: string } {
  const today = todayIn(timezone, now);
  switch (id) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = `${today.slice(0, 7)}-01`;
      const lastDay = addDays(first, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
  }
}

/** يتحقق من المدى محلياً قبل الطلب (الخادم يتحقق دائماً أيضاً). يعيد رمز خطأ أو null. */
export function rangeError(filters: ReportFilters): 'reversed' | 'too_long' | null {
  if (!filters.from || !filters.to) return null;
  if (filters.to < filters.from) return 'reversed';
  const days = (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86_400_000;
  return days > 366 ? 'too_long' : null;
}
