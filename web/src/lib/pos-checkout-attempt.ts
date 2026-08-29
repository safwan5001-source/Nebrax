/**
 * هوية محاولة إتمام بيع POS واحدة.
 * تُنشأ قبل الطلب وتبقى ثابتة أثناء إعادة المحاولة لنفس السلة/المحاولة،
 * وتتجدد فقط بعد نجاح نهائي أو reset صريح. ليست مصدر حقيقة مالية.
 */

export type PosCheckoutPhase =
  | 'idle'
  | 'submitting'
  | 'recovering'
  | 'success'
  | 'retryable_error';

export function createPosCheckoutAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // احتياطي لبيئات اختبار بلا crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** خطأ شبكة / انقطاع قبل استجابة HTTP مفسَّرة — صالح لإعادة محاولة آمنة بنفس المفتاح. */
export function isPosCheckoutNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network request failed')
    || message.includes('load failed')
    || message.includes('fetch failed')
  );
}

export class PosCheckoutAttemptController {
  private attemptId: string | null = null;

  /** يعيد المفتاح الحالي أو ينشئ واحداً إن لم توجد محاولة جارية. */
  ensure(): string {
    if (!this.attemptId) {
      this.attemptId = createPosCheckoutAttemptId();
    }
    return this.attemptId;
  }

  current(): string | null {
    return this.attemptId;
  }

  /** بعد نجاح البيع — المحاولة التالية هوية جديدة. */
  resetAfterSuccess(): void {
    this.attemptId = null;
  }

  /** إعادة تعيين صريحة (مغادرة شاشة الدفع بلا نجاح). */
  reset(): void {
    this.attemptId = null;
  }
}
