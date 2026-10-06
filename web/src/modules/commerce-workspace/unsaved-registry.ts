/**
 * FLOWERS-H2-2 (review) — سجلّ تعديلات غير محفوظة على مستوى مساحة التجارة. `beforeunload` لا يحمي من تبديل المتجر
 * داخل التطبيق (لا إعادة تحميل)، فتُسجِّل الشاشات التي بها مسوّدة حالتَها هنا (عبر `useUnsavedGuard`)، ويسأل مبدِّل
 * المتجر قبل أن يُسقط المسوّدة. السجلّ في الذاكرة فقط ولا يخزّن شيئاً.
 */
const dirtyOwners = new Set<symbol>();

export function setUnsavedOwner(owner: symbol, dirty: boolean): void {
  if (dirty) dirtyOwners.add(owner);
  else dirtyOwners.delete(owner);
}

export const hasUnsavedChanges = (): boolean => dirtyOwners.size > 0;

const DISCARD_MESSAGE = {
  ar: 'لديك تعديلات غير محفوظة. تبديل المتجر سيُسقطها. هل تريد المتابعة؟',
  en: 'You have unsaved changes. Switching store will discard them. Continue?',
} as const;

/** `true` إن لم تكن هناك مسوّدة أو أكّد المستخدم التجاهل. اللغة من وسم الصفحة (كما يضبطها التخطيط الجذر). */
export function confirmDiscardUnsaved(): boolean {
  if (!hasUnsavedChanges()) return true;
  const lang = typeof document === 'undefined' ? 'ar' : document.documentElement.lang;

  return window.confirm(lang.startsWith('en') ? DISCARD_MESSAGE.en : DISCARD_MESSAGE.ar);
}
