'use client';

import { useTranslations } from 'next-intl';

/**
 * تسمية `common.*` لمكوّن مشترك (حوار، تنبيه) دون أن يصير مزوّد الترجمة شرطاً
 * جديداً على كل مستهلك. في التطبيق المزوّد موجود دائماً (`Providers`) فتأتي
 * التسمية من الكتالوج؛ وفي سياق بلا مزوّد (اختبار مكوّن معزول) تُشتق من
 * `<html lang>` بنفس الكتالوج الثنائي.
 *
 * الاستدعاء داخل try ثابت الترتيب لكل نسخة: وجود المزوّد لا يتغيّر بين رسمَين.
 */
export function useCommonLabel(key: string, fallback: { ar: string; en: string }): string {
  let translate: ((k: string) => string) | null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    translate = useTranslations('common');
  } catch {
    translate = null;
  }
  if (translate) return translate(key);
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return lang.toLowerCase().startsWith('en') ? fallback.en : fallback.ar;
}
