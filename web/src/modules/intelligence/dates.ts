import { MAX_PERIOD_DAYS } from './contract';

/**
 * تحقق تواريخ الأداة من جهة العميل — **تجميلي فقط** كي لا يُرسَل طلب محكوم بالرفض؛ الخادم هو السلطة
 * (نفس القواعد: `Y-m-d` صارم، سنة ≥ 2000، لا مستقبل بتوقيت المؤسسة، من ≤ إلى، ≤ 366 يوماً).
 * «اليوم» يأتي من الخادم (`status.clock.today`)، لا من ساعة المتصفح.
 */

export type DateIssue = 'invalid' | 'future' | 'inverted' | 'too_long';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDay(value: string): number | null {
  if (!ISO.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const time = Date.UTC(y, m - 1, d);
  const back = new Date(time);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d || y < 2000) return null;
  return time;
}

export function checkDate(value: string, today: string): DateIssue | null {
  const day = toUtcDay(value);
  const now = toUtcDay(today);
  if (day === null || now === null) return 'invalid';
  return day > now ? 'future' : null;
}

export function checkPeriod(from: string, to: string, today: string): { from: DateIssue | null; to: DateIssue | null; range: DateIssue | null } {
  const issueFrom = checkDate(from, today);
  const issueTo = checkDate(to, today);
  if (issueFrom || issueTo) return { from: issueFrom, to: issueTo, range: null };
  const a = toUtcDay(from) as number;
  const b = toUtcDay(to) as number;
  if (a > b) return { from: null, to: null, range: 'inverted' };
  if ((b - a) / 86_400_000 + 1 > MAX_PERIOD_DAYS) return { from: null, to: null, range: 'too_long' };
  return { from: null, to: null, range: null };
}

export function monthStart(today: string): string {
  return `${today.slice(0, 8)}01`;
}
