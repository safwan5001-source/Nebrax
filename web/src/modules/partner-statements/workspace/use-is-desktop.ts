'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 768px)';

/** `md` فما فوق؟ الخادم/الترطيب الأول ⇒ `true` (المكتب) كي لا يومض Sheet الجوال؛ يُحدَّث فور التركيب. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const media = window.matchMedia(QUERY);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(QUERY).matches),
    () => true,
  );
}
