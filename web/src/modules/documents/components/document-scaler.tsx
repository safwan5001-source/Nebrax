'use client';

import { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recalc = () => {
      const avail = outer.clientWidth;
      const contentW = inner.scrollWidth || avail; // العرض الطبيعي (غير متأثّر بالتحويل)
      const scale = contentW > 0 ? Math.min(1, avail / contentW) : 1;
      const offsetX = Math.max(0, (avail - contentW * scale) / 2); // توسيط أفقي
      const height = inner.offsetHeight * scale; // ارتفاع طبيعي مضروب في المقياس
      setState({ scale, offsetX, height });
    };

    const ro = new ResizeObserver(recalc);
    ro.observe(outer);
    ro.observe(inner);
    recalc();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="doc-scaler-outer w-full overflow-hidden print:overflow-visible" style={{ height: state.height }}>
      <div
        ref={innerRef}
        className="doc-scaler-inner w-max"
        style={{ transform: `translateX(${state.offsetX}px) scale(${state.scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}
