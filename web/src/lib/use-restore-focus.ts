'use client';

import { useCallback, useState } from 'react';

/**
 * يعيد التركيز عند إغلاق لوحةٍ جانبية إلى العنصر الذي فتحها (AC-UX-09).
 *
 * لوحاتنا تُفتح بحالة تحكّمية من زرٍّ في صفٍّ لا بـ`Trigger` من Radix، فلا يعرف Radix أين يعيد التركيز
 * فيسقط على `body` ويفقد مستخدمُ لوحة المفاتيح موضعَه في الجدول. العنصر المفتوح منه يُلتقط عند أول
 * تركيب (وقتها يكون التركيز على الزر المنقور)؛ وإن اختفى عند الإغلاق (إعادة تصيير القائمة، أو تسليم
 * لوحة إلى أخرى) يُترك سلوك Radix الافتراضي كما هو.
 *
 * يُمرَّر الناتج إلى `onCloseAutoFocus` في `SheetContent`.
 */
export function useRestoreFocus(): (event: Event) => void {
  const [opener] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });

  return useCallback(
    (event: Event) => {
      if (opener?.isConnected) {
        event.preventDefault();
        opener.focus();
      }
    },
    [opener],
  );
}
