'use client';

import { useEffect } from 'react';

/**
 * حركة الصفحة كلها من مراقب واحد، بلا مكتبة:
 * - `[data-reveal]` يظهر تدريجياً عند دخوله الشاشة أول مرة (`data-revealed`).
 * - `[data-loop]` يحمل `data-inview` ما دام ظاهراً، فلا تعمل الحلقات المتكررة خارج الشاشة.
 *
 * الإخفاء الابتدائي مشروط بالصنف `lp-motion` على `.lp` ولا يُضاف إلا هنا وبلا تقليل حركة؛
 * فالصفحة بلا سكربت أو مع `prefers-reduced-motion` تظهر كاملة فوراً. الحركة `transform`/`opacity`
 * فقط فلا تُحسب إزاحةً في التخطيط (CLS).
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.lp');
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-revealed', '');
          reveal.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    const loop = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.setAttribute('data-inview', '');
        else entry.target.removeAttribute('data-inview');
      }
    });

    function start() {
      if (reduced.matches) {
        root!.classList.remove('lp-motion');
        return;
      }
      root!.classList.add('lp-motion');
      root!.querySelectorAll('[data-reveal]:not([data-revealed])').forEach((node) => reveal.observe(node));
      root!.querySelectorAll('[data-loop]').forEach((node) => loop.observe(node));
    }

    function onChange() {
      reveal.disconnect();
      loop.disconnect();
      start();
    }

    start();
    reduced.addEventListener('change', onChange);
    return () => {
      reduced.removeEventListener('change', onChange);
      reveal.disconnect();
      loop.disconnect();
      root.classList.remove('lp-motion');
    };
  }, []);

  return null;
}
