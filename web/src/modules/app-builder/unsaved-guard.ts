import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * AD-01 / S01b — حارس مغادرة الصفحة بتعديلات غير محفوظة. ثلاث طبقات:
 *  1) `beforeunload` (إغلاق/إعادة تحميل التبويب)،
 *  2) نقرات الروابط الداخلية (التقاط على `document` قبل موجّه Next) ⇒ حوار بدل التنقل،
 *  3) زر الرجوع `popstate`: عند dirty يُدفع إدخال سجلّ حارس (ينسخ `history.state` كي لا يعيد Next تحميل الصفحة)
 *     وعند الرجوع يُعاد دفعه ويُعرض الحوار.
 * لا تضيع التعديلات في أي حال: النسخة المحلية الاحتياطية (`draft-save.ts`) تبقى حتى الحفظ الناجح أو التجاهل الصريح.
 */
export type PendingLeave = { kind: 'link'; href: string } | { kind: 'back' };

export function useUnsavedChangesGuard(dirty: boolean, navigate: (href: string) => void = (href) => window.location.assign(href)) {
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const dirtyRef = useRef(dirty);
  const bypassRef = useRef(false);
  const guardEntryPushed = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || bypassRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current || bypassRef.current || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const target = anchor.getAttribute('target');
      if (anchor.hasAttribute('download') || (target && target !== '_self')) return;
      const raw = anchor.getAttribute('href') ?? '';
      if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(raw)) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ kind: 'link', href: `${url.pathname}${url.search}${url.hash}` });
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    function pushGuardEntry() {
      try {
        window.history.pushState(window.history.state, '', window.location.href);
        guardEntryPushed.current = true;
      } catch {
        // لا نكسر التنقل إن رفض المتصفح
      }
    }
    if (dirty && !guardEntryPushed.current) pushGuardEntry();

    function onPopState() {
      if (!dirtyRef.current || bypassRef.current) return;
      pushGuardEntry();
      setPending({ kind: 'back' });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty]);

  const confirmLeave = useCallback(() => {
    const current = pending;
    setPending(null);
    if (!current) return;
    bypassRef.current = true;
    if (current.kind === 'link') navigate(current.href);
    else window.history.go(guardEntryPushed.current ? -2 : -1);
  }, [pending, navigate]);

  const cancelLeave = useCallback(() => setPending(null), []);

  return { pending, confirmLeave, cancelLeave };
}
