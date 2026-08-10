/**
 * نطاق عرض قوائم المستندات: الفرع النشط (الافتراضي) أو كل الفروع.
 *
 * الخادم يصفّي بالفرع النشط **افتراضياً** (تصفية صريحة في المتحكّم، لا Global
 * Scope — حفاظاً على شمول ميزان المراجعة المجمّع). فغياب اللاحقة هو ما يُنتج
 * العرض المعزول، وحضورها وحده يفتح كل الفروع.
 */
export type BranchView = 'current' | 'all';

/**
 * يحوّل وضع العرض إلى لاحقة استعلام.
 *
 * @param hasQuery المسار يحمل سلسلة استعلام أصلاً (مثل `?type=sales`) — فتُلحق بـ `&`.
 */
export function branchViewQuery(view: BranchView, hasQuery = false): string {
  if (view !== 'all') return '';

  return hasQuery ? '&branch=all' : '?branch=all';
}
