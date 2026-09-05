export type PosTenderSettlementType = 'cash' | 'bank';

export interface PosTenderInput {
  methodId: string;
  amount: number;
  settlementType: PosTenderSettlementType;
}

export interface PosTenderSimulation {
  /** ترتيب التطبيق الفعلي: غير النقدي أولاً ثم النقدي أخيراً — مطابقٌ لما يُرسَل للخادم. */
  order: string[];
  appliedByMethodId: Record<string, number>;
  remainingMinor: number;
  /** الفكة: من النقد فقط، وهي الفارق بين المُدخَل والمُطبَّق لكل تحصيل نقدي. */
  changeMinor: number;
  /** أول وسيلة غير نقدية يتجاوز مبلغها المتبقي وقت تطبيقها — الخادم يرفض البيع كاملاً عندها. */
  invalidMethodId: string | null;
}

/**
 * يحاكي حلقة `PosService::checkout` التطبيقية حرفياً (app/Services/Accounting/PosService.php):
 * تُطبَّق كل وسيلة بحدّ أقصى `min(amount, remaining)` بالترتيب، وتُرفَض وسيلة بنكية
 * تتجاوز المتبقي وقتها بدل تقليصها (الخادم يرمي استثناءً فيُلغى البيع بأكمله).
 * الفكة نقدية حصراً: تحصيل بنكي زائد ليس فكّة ولا يُقبل إطلاقاً.
 *
 * **الترتيب مقصود لا اعتباطي:** وضع النقد أخيراً يجعل فكة الكاشير تُحسب من صافي
 * ما تبقّى بعد كل الوسائل الأخرى — تماماً كما يعالجها `PosService` عند نفس الترتيب،
 * وهذا الترتيب هو ما يُستخدم فعلياً عند الإرسال (انظر `orderedTenderPayload`) فتبقى
 * معاينة الكاشير ونتيجة الخادم متطابقتين حرفياً.
 *
 * دالة عرض/مساعدة قبل الإرسال فقط — الخادم يبقى المرجع النهائي دائماً.
 */
export function simulateTenders(totalMinor: number, tenders: PosTenderInput[]): PosTenderSimulation {
  const positive = tenders.filter((tender) => tender.amount > 0);
  const ordered = [
    ...positive.filter((tender) => tender.settlementType !== 'cash'),
    ...positive.filter((tender) => tender.settlementType === 'cash'),
  ];

  let remaining = Math.max(0, totalMinor);
  let changeMinor = 0;
  let invalidMethodId: string | null = null;
  const appliedByMethodId: Record<string, number> = {};

  for (const tender of ordered) {
    if (invalidMethodId !== null) break;

    if (tender.settlementType === 'bank' && tender.amount > remaining) {
      invalidMethodId = tender.methodId;
      break;
    }

    const applied = Math.min(tender.amount, remaining);
    appliedByMethodId[tender.methodId] = applied;
    if (tender.settlementType === 'cash') {
      changeMinor += tender.amount - applied;
    }
    remaining -= applied;
  }

  return {
    order: ordered.map((tender) => tender.methodId),
    appliedByMethodId,
    remainingMinor: remaining,
    changeMinor,
    invalidMethodId,
  };
}

/** نفس ترتيب `simulateTenders` بالضبط — يُستخدم عند الإرسال الفعلي للخادم. */
export function orderedTenderPayload(tenders: PosTenderInput[]): { payment_method_id: string; amount: number }[] {
  const positive = tenders.filter((tender) => tender.amount > 0);
  const ordered = [
    ...positive.filter((tender) => tender.settlementType !== 'cash'),
    ...positive.filter((tender) => tender.settlementType === 'cash'),
  ];
  return ordered.map((tender) => ({ payment_method_id: tender.methodId, amount: tender.amount }));
}
