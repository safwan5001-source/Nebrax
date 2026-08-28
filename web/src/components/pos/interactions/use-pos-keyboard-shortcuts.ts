'use client';

import { useEffect, useRef } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';
import { findPosShortcutByKey, type PosShortcutId } from '@/components/pos/interactions/shortcut-registry';

export type PosShortcutHandlers = Partial<Record<PosShortcutId, () => void>>;

/**
 * اختصارات نقطة البيع من مصدر الحقيقة الواحد (`POS_SHORTCUTS`)، بمفاتيح وظيفية
 * لا تتعارض مع ماسح الباركود لأنها ليست أحرفاً مفردة فلا تدخل مخزن المسح.
 *
 * المفتاح بلا معالج **لا يُلغى سلوكه الافتراضي**: هكذا يبقى Esc خارج شاشة الدفع
 * متاحاً لإغلاق الحوارات كما هو اليوم. والمعالج المُمرَّر دائماً يُلغى مفتاحه
 * دائماً ولو رفض التنفيذ داخلياً (F9 على سلة فارغة) — وهو السلوك القائم حرفياً.
 */
export function usePosKeyboardShortcuts(handlers: PosShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = findPosShortcutByKey(event.key);
      if (!shortcut) return;
      const handler = handlersRef.current[shortcut.id];
      if (!handler) return;
      if (shortcut.skipWhenEditable && isPosEditableTarget(document.activeElement)) return;
      event.preventDefault();
      handler();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
