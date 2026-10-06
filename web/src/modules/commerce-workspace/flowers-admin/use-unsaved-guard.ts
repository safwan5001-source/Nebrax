'use client';

import { useEffect, useRef } from 'react';
import { setUnsavedOwner } from '../unsaved-registry';

/**
 * يحذّر المتصفّح عند إغلاق/إعادة تحميل الصفحة وفيها تعديلات غير محفوظة، ويسجّل المسوّدة في سجلّ مساحة التجارة كي
 * يسأل مبدِّل المتجر قبل إسقاطها (التبديل داخل التطبيق لا يُطلق `beforeunload`).
 */
export function useUnsavedGuard(dirty: boolean): void {
  const owner = useRef<symbol>(Symbol('unsaved'));

  useEffect(() => {
    const token = owner.current;
    setUnsavedOwner(token, dirty);

    return () => setUnsavedOwner(token, false);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
