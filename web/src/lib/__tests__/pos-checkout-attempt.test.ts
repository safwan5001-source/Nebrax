import { describe, expect, it } from 'vitest';
import {
  PosCheckoutAttemptController,
  createPosCheckoutAttemptId,
  isPosCheckoutNetworkFailure,
} from '@/lib/pos-checkout-attempt';

describe('pos-checkout-attempt', () => {
  it('يبقي نفس مفتاح المحاولة أثناء إعادة المحاولة ويتجدد بعد النجاح', () => {
    const controller = new PosCheckoutAttemptController();
    const first = controller.ensure();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(controller.ensure()).toBe(first);
    expect(controller.current()).toBe(first);

    controller.resetAfterSuccess();
    const second = controller.ensure();
    expect(second).not.toBe(first);
  });

  it('ينشئ معرفاً جديداً بعد reset الصريح', () => {
    const controller = new PosCheckoutAttemptController();
    const first = controller.ensure();
    controller.reset();
    expect(controller.current()).toBeNull();
    expect(controller.ensure()).not.toBe(first);
  });

  it('يتبنّى مفتاح محاولة محفوظاً بدلاً من إنشاء مفتاح جديد', () => {
    const controller = new PosCheckoutAttemptController();
    const saved = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    controller.adopt(saved);
    expect(controller.current()).toBe(saved);
    expect(controller.ensure()).toBe(saved);
  });

  it('يميز فشل الشبكة عن أخطاء API', () => {
    expect(isPosCheckoutNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isPosCheckoutNetworkFailure(new Error('NetworkError when attempting to fetch'))).toBe(true);
    expect(isPosCheckoutNetworkFailure(new Error('validation failed'))).toBe(false);
    expect(isPosCheckoutNetworkFailure(createPosCheckoutAttemptId())).toBe(false);
  });
});
