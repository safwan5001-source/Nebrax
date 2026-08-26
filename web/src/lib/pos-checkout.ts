export interface PosCheckoutCompletion<TCheckout, TQr> {
  status: 'success' | 'payment_error';
  checkout?: TCheckout;
  qr: TQr | null;
}

interface RunPosCheckoutParams<TCheckout, TQr> {
  submitCheckout: () => Promise<TCheckout>;
  fetchQr: (checkout: TCheckout) => Promise<TQr>;
  onCheckoutSuccess: (checkout: TCheckout) => void;
  onPaymentError: (error: unknown) => void;
  onQrUnavailable: (error: unknown, checkout: TCheckout) => void;
}

/**
 * يفصل المصدر المالي الحاسم عن العمليات الثانوية. عند نجاح checkout لا يعود أي
 * فشل في QR نتيجة دفع، ويُنفذ onCheckoutSuccess أولاً كي تُغلق السلة قبل انتظار
 * العملية الثانوية، فلا تصبح السلة قابلة لإعادة الإرسال.
 */
export async function runPosCheckout<TCheckout, TQr>({
  submitCheckout,
  fetchQr,
  onCheckoutSuccess,
  onPaymentError,
  onQrUnavailable,
}: RunPosCheckoutParams<TCheckout, TQr>): Promise<PosCheckoutCompletion<TCheckout, TQr>> {
  let checkout: TCheckout;

  try {
    checkout = await submitCheckout();
  } catch (error) {
    onPaymentError(error);
    return { status: 'payment_error', qr: null };
  }

  onCheckoutSuccess(checkout);

  try {
    const qr = await fetchQr(checkout);
    return { status: 'success', checkout, qr };
  } catch (error) {
    onQrUnavailable(error, checkout);
    return { status: 'success', checkout, qr: null };
  }
}
