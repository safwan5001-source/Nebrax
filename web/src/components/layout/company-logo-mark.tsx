'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════
 *  CompanyLogoMark — علامة الشركة المربّعة في قشرة التطبيق
 * ═══════════════════════════════════════════════════════════════
 *  الشعار الكامل (الأفقي) يبقى للمستندات وشاشة الدخول؛ وهنا تُعرض **علامة
 *  مربّعة** بمقاس ثابت، فلا يمطّ شعارٌ عريض ترويسةَ الشريط.
 *
 *  ثلاثة قرارات عرض تستحقّ التثبيت:
 *
 *   • **`object-contain` لا `cover`.** الشعار الأفقي داخل مربّع يترك فراغاً
 *     على الجانبين — وهو أقلّ ضرراً من `cover` الذي كان يقصّ اسم الشركة نفسه.
 *
 *   • **خلفية بيضاء ثابتة في الوضعين.** أغلب الشعارات مصمَّمة على أبيض
 *     وكثيرٌ منها بنصّ داكن؛ فوضعُها على خلفية داكنة يُخفي الشعار. الأبيض
 *     الثابت يضمن ظهوره في الثيمين، ولذلك لا يُشتقّ من رموز الثيم.
 *
 *   • **`onError` يرجع إلى الحرف.** رابطٌ تالف أو صورة محذوفة كانا يتركان
 *     مربّعاً فارغاً في ترويسة كل صفحة — والحرف أوضح من الفراغ.
 */
export function CompanyLogoMark({
  logo,
  name,
  size = 'sm',
  className,
}: {
  /** data URL أو فارغ. */
  logo?: string | null;
  /** اسم الشركة — يُشتقّ منه الحرف الاحتياطي. */
  name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  // شعارٌ جديد بعد رفعه يستحقّ محاولة جديدة — وإلا بقي «مكسوراً» إلى التحديث.
  useEffect(() => setBroken(false), [logo]);

  const box = size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  const letter = size === 'md' ? 'text-sm' : 'text-xs';

  // الحرف الأول من اسم الشركة، و«ن» احتياطاً قبل وصول البيانات.
  const initial = (name ?? '').trim().charAt(0) || 'ن';

  if (logo && !broken) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5',
          box,
          className
        )}
      >
        <img
          src={logo}
          alt={name ?? ''}
          className="max-h-full max-w-full object-contain"
          onError={() => setBroken(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-white',
        box,
        letter,
        className
      )}
    >
      {initial}
    </div>
  );
}
