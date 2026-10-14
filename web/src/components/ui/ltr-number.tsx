import * as React from 'react';

const NUMERIC = /^[-+]?\s?[\d٠-٩]/;

/**
 * يعزل نصاً رقمياً (مبلغاً أو نسبة) باتجاه LTR داخل سياق RTL، فتبقى الإشارة السالبة
 * يسار الأرقام («-10,471.50 𞸁» لا «10,471.50-»). عزلٌ سطري (`<bdi dir="ltr">`) لا يغيّر
 * محاذاة الخلية أو البطاقة الحاوية. النص غير الرقمي يمرّ كما هو — design-system/v3/
 * FOUNDATIONS.md §5 قاعدة 5 و§12.3 (ERP-UX-027). مكوّن عرض فقط: لا يغيّر القيمة.
 */
export function LtrNumber({ children }: { children: React.ReactNode }) {
  if (typeof children !== 'string' || !NUMERIC.test(children.trim())) return <>{children}</>;
  return <bdi dir="ltr">{children}</bdi>;
}
