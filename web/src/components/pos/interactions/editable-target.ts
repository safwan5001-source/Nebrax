/**
 * حقلٌ يكتب فيه المستخدم فعلاً: لا يلتقطه ماسح الباركود ولا يبتلعه اختصار.
 *
 * كان الشرط مكرراً حرفياً في مستمعَي لوحة المفاتيح داخل شاشة نقطة البيع، فأي
 * تعديل على أحدهما كان يترك الآخر بسلوك مختلف صامت. هنا مصدرٌ واحد يستهلكه
 * الماسح والاختصارات معاً.
 */
export function isPosEditableTarget(element: Element | null): boolean {
  if (!element) return false;
  const candidate = element as HTMLElement;
  return candidate.tagName === 'INPUT'
    || candidate.tagName === 'TEXTAREA'
    || candidate.isContentEditable === true;
}
