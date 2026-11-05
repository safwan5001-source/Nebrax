import type { WriteResult } from './write-client';

/**
 * UI-2 — ترجمة نتيجة الكتابة إلى رسالة موظف (دالة نقية). `ok` ⇒ `null` (لا إشعار فشل).
 * `canCheck` = يفيد «تحقق من الحالة» (إعادة قراءة الوردية من الخادم): كل ما قد يكون حدث فعلاً أو تغيّر عنده الوضع.
 * رسالة الخادم الأصلية تُعرض فقط للرفض غير المصنَّف (`validation`) كتفصيل ثانوي — لا نخفي سبب الرفض ولا نخمّنه.
 */
export interface WriteFailure {
  tone: 'error' | 'warning';
  messageKey: string;
  serverMessage: string | null;
  canCheck: boolean;
}

const REFRESH_WORTHY = new Set(['shift_not_open', 'reading_exists', 'evidence_conflict', 'conflict', 'idempotency_conflict', 'shift_already_open', 'staff_already_assigned']);

export function describeFailure(result: WriteResult): WriteFailure | null {
  switch (result.kind) {
    case 'ok':
      return null;
    case 'rejected':
      return {
        tone: 'error',
        messageKey: `write.reject.${result.code}`,
        serverMessage: result.code === 'validation' ? result.serverMessage : null,
        canCheck: REFRESH_WORTHY.has(result.code),
      };
    case 'unknown':
      return { tone: 'warning', messageKey: `write.unknown.${result.reason}`, serverMessage: null, canCheck: true };
    case 'unverified':
      return { tone: 'warning', messageKey: 'write.unverified', serverMessage: null, canCheck: true };
    case 'not_sent':
      return { tone: 'warning', messageKey: `write.notSent.${result.reason}`, serverMessage: null, canCheck: false };
  }
}

/** نتيجة تعني أن الإرسال قد يكون أثّر في الخادم (لا يجوز إعلان فشل نهائي ولا مسح مفتاح النية). */
export function mayHaveApplied(result: WriteResult): boolean {
  return result.kind === 'unknown' || result.kind === 'unverified';
}

/**
 * هل يُمسح مفتاح النية بعد هذه النتيجة؟ فقط **رفض نهائي** وبشرط ألا تسبقه محاولة غير مؤكدة لنفس النية (`uncertain`): محاولة سابقة قد تكون
 * التزمت في الخادم، ورفضٌ أو «لم يُرسل» لاحق لا يثبت العكس — فيبقى المفتاح نفسه لتعيد المحاولة التالية الأثر الأول بدل أثر ثانٍ.
 * `not_sent` (دون اتصال) لا يمسح أبداً.
 */
export function shouldClearIntentKey(result: WriteResult, uncertain: boolean): boolean {
  return result.kind === 'rejected' && !uncertain;
}
