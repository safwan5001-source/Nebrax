'use client';

import { useEffect, useState } from 'react';
import { AwjLogo } from '@/components/layout/awj-logo';
import { cn } from '@/lib/utils';

/**
 * علامة المؤسسة في قشرة لوحة التحكم.
 *
 * يحظى الشعار الذي ترفعه المؤسسة من الإعدادات بالأولوية المطلقة. وعندما لا
 * يوجد شعار مرفوع — كما في الحسابات الجديدة — يظهر شعار أَوْج المتكيف مع
 * الوضع النشط بدلاً من حرف ثابت، ويعود تلقائياً إلى شعار المؤسسة عند
 * حفظه في الإعدادات.
 */
export function CompanyLogoMark({
  logo,
  name,
  size = 'sm',
  className,
}: {
  /** data URL أو فارغ. */
  logo?: string | null;
  /** اسم الشركة، لنص بديل ذي معنى عند وجود شعار مرفوع. */
  name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const logoClass = size === 'md' ? 'h-9 w-auto' : 'h-7 w-auto';

  // شعار جديد بعد رفعه يستحقّ محاولة جديدة — وإلا بقيت القشرة على البديل.
  useEffect(() => setBroken(false), [logo]);

  if (logo && !broken) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5',
          size === 'md' ? 'h-9 w-9' : 'h-7 w-7',
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

  return <AwjLogo alt="" variant={size === 'sm' ? 'mark' : 'wordmark'} className={cn('shrink-0', logoClass, className)} />;
}

