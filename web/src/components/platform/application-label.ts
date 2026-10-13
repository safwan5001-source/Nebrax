/**
 * اسم التطبيق المعروض في شاشات المنصة. المصدر الوحيد للأسماء هو قاموس الرسائل الحالي `applications.keys.*`؛
 * هذا الملف لا يضيف قاموساً موازياً. مفتاح الكتالوج التقني (`document_center.core`) يبقى كما هو في الـAPI وقاعدة البيانات،
 * ويُحوَّل هنا فقط إلى مفتاح الرسالة (`document_center_core`).
 */
export type ApplicationsTranslator = ((key: string) => string) & { has?: (key: string) => boolean };

export function applicationMessageKey(applicationKey: string): string {
  return `keys.${applicationKey.replaceAll('.', '_')}`;
}

/**
 * الاسم المترجَم، وإن لم تكن له ترجمة (تطبيق جديد في الكتالوج قبل ترجمته) فالمفتاح التقني نفسه.
 * لا يُعرض أبداً مسار الرسالة الخام (`applications.keys.…`) ولا يُسجَّل خطأ MISSING_MESSAGE. المفتاح التقني يُعرض
 * في الواجهة بعرض يلتف (`break-words`)، فلا يوسّع الصفحة.
 */
export function applicationLabel(t: ApplicationsTranslator, applicationKey: string): string {
  const messageKey = applicationMessageKey(applicationKey);
  if (typeof t.has === 'function' && !t.has(messageKey)) return applicationKey;
  return t(messageKey);
}
