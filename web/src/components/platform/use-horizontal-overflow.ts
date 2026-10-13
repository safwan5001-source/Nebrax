'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * هل يتجاوز محتوى العنصر عرضه فيتمرّر أفقياً؟ تُقاس عند التركيب وعند تغيّر الحجم (ResizeObserver، أو `resize` النافذة
 * إن لم يتوفر). يُستعمل لمنح منطقة التمرير مدخل لوحة المفاتيح (`tabIndex`) **حين تتمرّر فعلاً** فقط: منطقة لا تتمرّر
 * لا تحتاج Tab stop، ومنطقة تتمرّر بلا محتوى قابل للتركيز لا يصل إليها مستخدم لوحة المفاتيح بدونه (axe: scrollable-region-focusable).
 * العنصر المخفيّ (`display:none`) يقيس 0 فلا يُعدّ متجاوزاً.
 */
export function useHorizontalOverflow<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [overflows, setOverflows] = useState(false);
  const ref = useCallback((element: T | null) => setNode(element), []);

  useEffect(() => {
    if (!node) {
      setOverflows(false);
      return;
    }
    const measure = (): void => setOverflows(node.scrollWidth > node.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [node]);

  return [ref, overflows];
}
