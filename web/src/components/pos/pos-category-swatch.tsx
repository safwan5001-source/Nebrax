'use client';

import { Package } from 'lucide-react';

/**
 * PR-2C: تمثيل «لون» لتصنيف POS — معرّف تشغيلي بحت (بيانات عميل)، لا هوية
 * AWJ. اللون يملأ مربّع الأيقونة الصغير فقط؛ نص اسم التصنيف يبقى دوماً على
 * خلفية البطاقة المحايدة (لا فوق اللون)، فلا حاجة لحساب تباين — لا نص يُكتب
 * فوق لون حرّ إطلاقاً. لون غير آمن أو غائب يسقط على نفس الأيقونة المحايدة
 * التي تستعملها صورة التصنيف عند غيابها.
 */
export function PosCategorySwatch({ color, alt }: { color: string | null | undefined; alt: string }) {
  const safeColor = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;

  if (!safeColor) {
    return (
      <span className="grid h-full w-full place-items-center bg-primary-soft text-primary" aria-hidden>
        <Package className="h-5 w-5" strokeWidth={1.6} />
      </span>
    );
  }

  return <span className="block h-full w-full" style={{ backgroundColor: safeColor }} role="img" aria-label={alt} />;
}
