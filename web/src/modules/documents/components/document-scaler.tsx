'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * يقيس عرض الحاوية ويُصغّر المستند بصرياً ليملأ العرض على الشاشات الضيّقة (الجوال)
 * فيظهر القالب كاملاً، دون قصّ أو تمرير أفقي. **الطباعة والـ PDF لا تتأثّران:**
 * يُلغى التحويل عند الطباعة (globals.css)، والـ PDF يلتقط #print-root بحجمه الطبيعي.
 */
export function DocumentScaler({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recalc = () => {
      const avail = outer.clientWidth;
      const contentW = inner.scrollWidth || avail; // العرض الطبيعي للمستند (غير متأثّر بالتحويل)
      const s = contentW > 0 ? Math.min(1, avail / contentW) : 1;
      setScale(s);
      setHeight(inner.offsetHeight * s); // offsetHeight طبيعي (لا يتأثّر بالتحويل)
    };

    const ro = new ResizeObserver(recalc);
    ro.observe(outer);
    ro.observe(inner);
    recalc();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className="doc-scaler-outer w-full overflow-hidden print:overflow-visible" style={{ height }}>
      <div
        ref={innerRef}
        className="doc-scaler-inner mx-auto w-max"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
      >
        {children}
      </div>
    </div>
  );
}
