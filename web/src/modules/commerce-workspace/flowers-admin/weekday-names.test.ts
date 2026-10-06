import { describe, expect, it } from 'vitest';
import { summarizeWeekdays, weekdayName, weekdayOrder } from './weekday-names';

describe('weekday names', () => {
  it('names Sunday as day 0 in both locales', () => {
    expect(weekdayName(0, 'en', 'long')).toBe('Sunday');
    expect(weekdayName(6, 'en', 'long')).toBe('Saturday');
    expect(weekdayName(0, 'ar', 'long')).toBe('الأحد');
    expect(weekdayName(5, 'ar', 'long')).toBe('الجمعة');
  });

  it('orders the week Saturday-first in Arabic and Sunday-first in English', () => {
    expect(weekdayOrder('ar')).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(weekdayOrder('en')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('summarizes all days or lists the chosen ones in local order', () => {
    expect(summarizeWeekdays([0, 1, 2, 3, 4, 5, 6], 'en', 'Every day')).toBe('Every day');
    expect(summarizeWeekdays([], 'en', 'Every day')).toBe('Every day');
    expect(summarizeWeekdays([5, 0, 1], 'en', 'Every day')).toBe('Sun, Mon, Fri');
    expect(summarizeWeekdays([5, 6], 'ar', 'كل الأيام')).toContain('،');
  });
});
