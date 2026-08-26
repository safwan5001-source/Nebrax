import { describe, expect, it, vi } from 'vitest';
import { runPosCheckout } from '@/lib/pos-checkout';

describe('إتمام POS بعد checkout', () => {
  it('يبقي البيع ناجحاً وينظف السلة عند فشل QR ولا يعيد إرسال الدفع', async () => {
    let cart = ['line-1'];
    let step: 'payment' | 'sale' = 'payment';
    const checkout = { data: { id: 'invoice-1', number: 'INV-1', total: '115.00' } };
    const submitCheckout = vi.fn(async () => checkout);
    const fetchQr = vi.fn(async () => {
      // يجب أن يكون cleanup قد حدث قبل العملية الثانوية، فلا تبقى السلة قابلة للدفع.
      expect(cart).toEqual([]);
      expect(step).toBe('sale');
      throw new Error('QR unavailable');
    });
    const onPaymentError = vi.fn();
    const onQrUnavailable = vi.fn();

    const result = await runPosCheckout({
      submitCheckout,
      fetchQr,
      onCheckoutSuccess: () => {
        cart = [];
        step = 'sale';
      },
      onPaymentError,
      onQrUnavailable,
    });

    expect(result).toEqual({ status: 'success', checkout, qr: null });
    expect(submitCheckout).toHaveBeenCalledTimes(1);
    expect(fetchQr).toHaveBeenCalledWith(checkout);
    expect(onPaymentError).not.toHaveBeenCalled();
    expect(onQrUnavailable).toHaveBeenCalledTimes(1);
    expect(cart).toEqual([]);
    expect(step).toBe('sale');
  });

  it('يعامل فشل checkout فقط كفشل دفع ولا يطلب QR', async () => {
    const checkoutError = new Error('Checkout rejected');
    const submitCheckout = vi.fn(async () => { throw checkoutError; });
    const fetchQr = vi.fn();
    const onPaymentError = vi.fn();
    const onQrUnavailable = vi.fn();

    const result = await runPosCheckout({
      submitCheckout,
      fetchQr,
      onCheckoutSuccess: vi.fn(),
      onPaymentError,
      onQrUnavailable,
    });

    expect(result).toEqual({ status: 'payment_error', qr: null });
    expect(onPaymentError).toHaveBeenCalledWith(checkoutError);
    expect(fetchQr).not.toHaveBeenCalled();
    expect(onQrUnavailable).not.toHaveBeenCalled();
  });
});
