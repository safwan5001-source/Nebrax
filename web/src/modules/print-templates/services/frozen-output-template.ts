export interface FrozenOutputTemplateRevision<TDefinition extends object = Record<string, unknown>> {
  definition: TDefinition;
}

/**
 * يحدد تعريف إخراج تاريخي للمستند المرحّل. مراجعة PDF المخصصة لها الأولوية؛
 * إذا لم يكن تعيين PDF موجوداً عند ترحيل مستند قديم أو في مستأجر لم يخصصه بعد،
 * تستخدم مراجعة الطباعة التي ثُبّتت وقت الإصدار. لا تتصل هذه الدالة أبداً
 * بإعدادات تصميم حية، حتى لا يتغير ملف مستند صدر مسبقاً.
 */
export function resolveFrozenOutputDefinition<TDefinition extends object>(
  pdfRevision: FrozenOutputTemplateRevision<TDefinition> | null | undefined,
  printRevision: FrozenOutputTemplateRevision<TDefinition> | null | undefined,
): TDefinition | null {
  return pdfRevision?.definition ?? printRevision?.definition ?? null;
}
