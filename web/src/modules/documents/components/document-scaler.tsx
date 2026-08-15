'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * يقيس عرض الحاوية ويُصغّر المستند بصرياً ليملأ العرض على الشاشات الضيّقة (الجوال)
 * فيظهر القالب كاملاً ومتوسّطاً دون قصّ أو تمرير أفقي. **الطباعة والـ PDF لا تتأثّران:**
 * يُلغى التحويل عند الطباعة (globals.css) وأثناء التقاط الـ PDF (lib/pdf.ts)، فيُصوَّر
 * المستند بحجمه الطبيعي.
 */
export function DocumentScaler({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ scale: number; offsetX: number; height?: number }>({ scale: 1, offsetX: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let frame = 0;
    const recalc = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const avail = outer.getBoundingClientRect().width;
        const contentW = inner.scrollWidth;
        if (!avail || !contentW) return;
        const scale = Math.min(1, avail / contentW);
        const offsetX = Math.max(0, (avail - contentW * scale) / 2);
        const height = inner.offsetHeight * scale;
        setState((previous) => (
          previous.scale === scale && previous.offsetX === offsetX && previous.height === height
            ? previous
            : { scale, offsetX, height }
        ));
      });
    };

    const ro = new ResizeObserver(recalc);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener('resize', recalc);
    // تحميل الخط أو QR أو الشعار قد يغيّر ارتفاع المستند بعد أول قياس على الجوال.
    void document.fonts?.ready.then(recalc);
    recalc();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', recalc);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      dir="ltr"
      className="doc-scaler-outer w-full overflow-hidden print:overflow-visible"
      style={state.height ? { height: state.height } : undefined}
    >
      <div
        ref={innerRef}
        dir="ltr"
        className="doc-scaler-inner w-max"
        style={{ transform: `translate3d(${state.offsetX}px, 0, 0) scale(${state.scale})`, transformOrigin: 'top left', willChange: 'transform' }}
      >
        {children}
      </div>
    </div>
  );
}
