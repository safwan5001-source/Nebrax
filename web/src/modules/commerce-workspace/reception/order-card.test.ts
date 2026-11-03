import { describe, expect, it } from 'vitest';
import { elapsedLabel, scheduleText } from './order-card';

describe('عرض البطاقة', () => {
  it('elapsedLabel: الآن / دقائق / ساعات ودقائق، بالعربية والإنجليزية، وnull عند الغياب', () => {
    expect(elapsedLabel(0, 'ar')).toBe('الآن');
    expect(elapsedLabel(12, 'ar')).toBe('منذ 12 د');
    expect(elapsedLabel(65, 'ar')).toBe('منذ 1 س 5 د');
    expect(elapsedLabel(65, 'en')).toBe('1 h 5 min ago');
    expect(elapsedLabel(null, 'ar')).toBeNull();
  });

  it('scheduleText: التاريخ معزول LTR ثم النافذة بلغة الواجهة، وnull بلا جدولة', () => {
    const slot = { label: 'مساءً', label_en: 'Evening', start_time: '17:00', end_time: '20:00' };
    const schedule = { method: 'delivery', date: '2026-11-04', slot, timezone: 'Asia/Riyadh' };
    expect(scheduleText(schedule, 'ar')).toBe('⁦2026-11-04⁩ · مساءً');
    expect(scheduleText(schedule, 'en')).toBe('⁦2026-11-04⁩ · Evening');
    expect(scheduleText({ ...schedule, slot: { ...slot, label: null, label_en: null } }, 'ar')).toBe('⁦2026-11-04⁩ · 17:00–20:00');
    expect(scheduleText(null, 'ar')).toBeNull();
    expect(scheduleText(undefined, 'ar')).toBeNull();
  });
});
