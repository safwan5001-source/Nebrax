'use client';

import { useEffect, useRef } from 'react';

/**
 * باركود المستند (Code128) — يُرسَم SVG عبر jsbarcode (استيراد ديناميكي فلا يُثقل
 * الحزمة إلا عند استخدامه). يُلتقَط ضمن الـ DOM للطباعة/PDF.
 */
export function DocBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let active = true;
    void import('jsbarcode').then(({ default: JsBarcode }) => {
      if (active && ref.current) {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          height: 40,
          width: 1.6,
          margin: 0,
          displayValue: false,
          lineColor: '#000000',
        });
      }
    });
    return () => {
      active = false;
    };
  }, [value]);

  return <svg ref={ref} className="h-10" role="img" aria-label={value} />;
}
