import { useRef } from 'react';

/**
 * مفتاح idempotency **ثابت لكل نية** (FS-08).
 *
 * توليد `crypto.randomUUID()` داخل معالج الإرسال يجعل كل محاولة «نية جديدة» للخادم: إعادة الإرسال بعد مهلة أو انقطاع
 * (والحوار ما زال مفتوحاً) تُنشئ حركة نقد أو دفعة جزئية أو مسودة أو استلاماً مكرراً. هنا يبقى المفتاح نفسه ما دامت
 * الحمولة نفسها، فيعرف الخادم أنها المحاولة ذاتها ويُرجع الأثر الأول بدل تكراره.
 *
 * - **البصمة** (`fingerprint`) هي الحمولة المقصودة؛ إن تغيّر أي حقل بين محاولتين فهي نية مختلفة ⇒ مفتاح جديد
 *   (لا يُعاد استعمال مفتاح لحمولة مختلفة، فلا يُرجَع أثر قديم لطلب جديد).
 * - `reset()` بعد النجاح (أو إلغاء الحوار) كي لا تتشارك نيتان مستقلتان متطابقتان مفتاحاً.
 */
export interface IntentKeys {
  keyFor(payload: unknown, prefix?: string): string;
  reset(): void;
}

export function createIntentKeys(generate: () => string = () => crypto.randomUUID()): IntentKeys {
  let current: { fingerprint: string; key: string } | null = null;

  return {
    keyFor(payload, prefix = '') {
      const fingerprint = JSON.stringify(payload);
      if (current === null || current.fingerprint !== fingerprint) {
        current = { fingerprint, key: `${prefix}${generate()}` };
      }
      return current.key;
    },
    reset() {
      current = null;
    },
  };
}

/** نسخة ثابتة عبر إعادة الرسم لكل نية (استدعِها مرة لكل نوع إرسال في المكوّن). */
export function useIntentKeys(): IntentKeys {
  const ref = useRef<IntentKeys | null>(null);
  if (ref.current === null) ref.current = createIntentKeys();

  return ref.current;
}
