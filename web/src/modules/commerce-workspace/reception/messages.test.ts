import { describe, expect, it } from 'vitest';
import { RECEPTION_MESSAGES, receptionMessages } from './messages';

describe('رسائل مساحة الاستقبال', () => {
  it('مفاتيح ar وen متطابقة وغير فارغة', () => {
    expect(Object.keys(RECEPTION_MESSAGES.en).sort()).toEqual(Object.keys(RECEPTION_MESSAGES.ar).sort());
    for (const dict of [RECEPTION_MESSAGES.ar, RECEPTION_MESSAGES.en]) {
      for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('لا صياغة وعد ممنوعة (ADR-30 §5.3 / R-11): لا خلفية ولا جوال مقفل ولا فوري/مضمون', () => {
    const forbidden = [/لن تفوتك/, /دائماً|دائما/, /فوري/, /على الجوال/, /مضمون/, /never miss/i, /always/i, /instant/i, /guarantee/i, /works in the background/i, /locked.*(works|delivered)/i];
    for (const dict of [RECEPTION_MESSAGES.ar, RECEPTION_MESSAGES.en]) {
      for (const [key, value] of Object.entries(dict)) {
        for (const re of forbidden) expect(re.test(value), `${key}: ${value}`).toBe(false);
      }
    }
  });

  it('t يستبدل المتغيّرات', () => {
    expect(receptionMessages('ar').t('elapsedMinutes', { m: 5 })).toBe('منذ 5 د');
    expect(receptionMessages('en').t('scheduledFor', { when: 'x' })).toBe('Scheduled for x');
  });
});
