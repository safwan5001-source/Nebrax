export type PosCategoryPresentationMode = 'default' | 'image' | 'color';

export interface PosCategoryVisualInput {
  /** تبويب «الكل» ليس تصنيفاً حقيقياً — يحتفظ بأيقونته الثابتة دوماً. */
  isAllTab: boolean;
  image: string | null;
  color: string | null;
}

export type PosCategoryVisualDecision =
  | { kind: 'all-icon' }
  | { kind: 'neutral-icon' }
  | { kind: 'image'; path: string | null }
  | { kind: 'color'; color: string | null };

/**
 * منطق القرار الصرف لعرض تصنيف POS — بلا JSX، فقابل للاختبار مباشرة دون
 * تركيب الصفحة كاملة. القاعدة الحاكمة: صورة أو لون حصراً (XOR) — لا يظهران
 * معاً أبداً مهما توفّرت بيانات كلا الحقلين على التصنيف نفسه.
 */
export function resolveCategoryVisual(
  mode: PosCategoryPresentationMode,
  input: PosCategoryVisualInput,
): PosCategoryVisualDecision {
  if (input.isAllTab) return { kind: 'all-icon' };
  if (mode === 'color') return { kind: 'color', color: input.color };
  if (mode === 'default') return { kind: 'neutral-icon' };
  return { kind: 'image', path: input.image };
}
