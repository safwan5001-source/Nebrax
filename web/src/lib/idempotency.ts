/**
 * مفتاح Idempotency لطلبات الإنشاء المالية (مصروف/دفعة) — AWJ-HORIZON-MEDIA-STORAGE S3.
 *
 * القاعدة: المفتاح يُولَّد لكل «نية إرسال»، ويُعاد استعماله ما دامت الحمولة نفسها (إعادة محاولة
 * بعد انقطاع الاستجابة فيُعيد الخادمُ النتيجة المحفوظة ولا يُنشئ سجلاً ثانياً). إن عدّل المستخدم
 * الحمولة قبل إعادة الإرسال يُولَّد مفتاح جديد (وإلا رفض الخادم 409 لتعارض الحمولة). عند النجاح
 * يُستدعى `done()` فيبدأ الإرسال التالي (حتى لو مطابقاً) عمليةً جديدة مشروعة.
 */
export interface IdempotencyGuard {
  keyFor(body: FormData | Record<string, unknown>): string;
  done(): void;
}

function newKey(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `idem-${c.randomUUID()}`;
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function signatureOf(body: FormData | Record<string, unknown>): string {
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, name) => {
      parts.push(
        typeof value === 'string'
          ? `${name}=${value}`
          : `${name}=file:${(value as File).name}:${(value as File).size}:${(value as File).lastModified}`,
      );
    });
    return parts.join('\n');
  }
  return JSON.stringify(body, Object.keys(body as object).sort());
}

export function createIdempotencyGuard(): IdempotencyGuard {
  let last: { signature: string; key: string } | null = null;
  return {
    keyFor(body) {
      const signature = signatureOf(body);
      if (last === null || last.signature !== signature) {
        last = { signature, key: newKey() };
      }
      return last.key;
    },
    done() {
      last = null;
    },
  };
}
