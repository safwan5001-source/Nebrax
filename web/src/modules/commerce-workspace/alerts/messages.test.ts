import { describe, expect, it } from 'vitest';
import { ALERT_MESSAGES, alertMessages } from './messages';

describe('رسائل مركز التنبيه', () => {
  it('مفاتيح ar وen متطابقة وغير فارغة', () => {
    expect(Object.keys(ALERT_MESSAGES.en).sort()).toEqual(Object.keys(ALERT_MESSAGES.ar).sort());
    for (const dict of [ALERT_MESSAGES.ar, ALERT_MESSAGES.en]) {
      for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('نصوص الموثوقية الملزمة موجودة (ADR-30 §5.3) ولا صياغة وعد ممنوعة', () => {
    expect(ALERT_MESSAGES.ar.reliabilityOn).toBe('تصلك تنبيهات الطلبات الجديدة بينما تبقى هذه الصفحة مفتوحة. للحصول على الصوت، فعّله على هذا الجهاز.');
    expect(ALERT_MESSAGES.ar.reliabilityLimits).toBe('قد يتأخر التنبيه أو لا يصل إذا كانت الصفحة في الخلفية أو كان الجهاز مقفلاً.');
    expect(ALERT_MESSAGES.en.reliabilityOn).toBe('New-order alerts reach you while this page stays open. Enable sound on this device to hear them.');
    expect(ALERT_MESSAGES.en.reliabilityLimits).toBe('Alerts may be delayed or missed if this page is in the background or the device is locked.');

    const forbidden = [/لن تفوتك/, /دائماً|دائما/, /فوري/, /في الخلفية.*(يعمل|تعمل)/, /على الجوال/, /never miss/i, /always/i, /instant/i, /guarantee/i, /works in the background/i, /locked.*(works|delivered)/i];
    for (const dict of [ALERT_MESSAGES.ar, ALERT_MESSAGES.en]) {
      for (const [key, value] of Object.entries(dict)) {
        for (const re of forbidden) expect(re.test(value), `${key}: ${value}`).toBe(false);
      }
    }
  });

  it('t يستبدل المتغيّرات والسبب المجهول يعود حرفياً', () => {
    const ar = alertMessages('ar');
    expect(ar.t('pendingCount', { count: 3 })).toBe('بانتظارك: 3');
    expect(alertMessages('en').t('lastUpdate', { seconds: 4 })).toBe('Updated 4s ago');
    expect(ar.reason('new_order')).toBe('طلب جديد');
    expect(ar.reason('future_reason')).toBe('future_reason');
  });
});
