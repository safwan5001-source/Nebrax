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
  ar: 'لديك تعديلات غير محفوظة. المتابعة ستُسقطها. هل تريد المتابعة؟',
  en: 'You have unsaved changes. Continuing will discard them. Continue?',
} as const;

/** `true` إن لم تكن هناك مسوّدة أو أكّد المستخدم التجاهل. اللغة من وسم الصفحة (كما يضبطها التخطيط الجذر). */
export function confirmDiscardUnsaved(): boolean {
  if (!hasUnsavedChanges()) return true;
  const lang = typeof document === 'undefined' ? 'ar' : document.documentElement.lang;

  return window.confirm(lang.startsWith('en') ? DISCARD_MESSAGE.en : DISCARD_MESSAGE.ar);
}

/**
 * التنقّل بين صفحات التطبيق (روابط Next.js) لا يُطلق `beforeunload`، فتضيع المسوّدة بصمت عند فتح أي رابط من الشريط
 * الجانبي أو العلوي. مستمع نقر في **مرحلة الالتقاط** يسأل قبل أن يعالج الرابط نفسه؛ الرفض يلغي التنقّل. يتجاهل النقر
 * المعدَّل (تبويب جديد)، وروابط التنزيل/النافذة الجديدة، والروابط الخارجية، وروابط الصفحة نفسها (`#hash`).
 * (زرّ الرجوع في المتصفّح خارج نطاقه: لا واجهة موثوقة لإلغائه في App Router.)
 */
export function installUnsavedNavigationGuard(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!hasUnsavedChanges()) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    if (!confirmDiscardUnsaved()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener('click', onClick, true);

  return () => document.removeEventListener('click', onClick, true);
}
