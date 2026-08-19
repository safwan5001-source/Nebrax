'use client';

import type { CSSProperties } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

const LOGO_ASSETS = {
  ar: {
    src: '/brand/nebrax-logo.png',
    width: 1026,
    height: 680,
  },
  en: {
    src: '/brand/nebrax-logo-en.png',
    width: 1466,
    height: 959,
  },
} as const;

/**
 * شعار نبراكس المتكيف مع اللغة ووضع العرض.
 *
 * يستخدم الأصل الشفاف بوصفه قناعاً، لا لوناً مضمّناً في الصورة. لذلك يأخذ
 * الشعار العربي وNEBRAX اللون `--primary` ذاته تلقائياً: #1E40AF في الوضع
 * الفاتح و#4F8CFF في الوضع الداكن، وأي تغيير مستقبلي في رمز الهوية ينعكس
 * على النسختين في الوقت نفسه.
 */
export function NebraxLogo({
  alt = '',
  className,
  priority = false,
}: {
  alt?: string;
  className?: string;
  /** محفوظ لتوافق مواضع الاستخدام السابقة؛ أصل القناع لا يطلب تحميلاً مسبقاً. */
  priority?: boolean;
}) {
  const locale = useLocale();
  const asset = locale === 'en' ? LOGO_ASSETS.en : LOGO_ASSETS.ar;
  void priority;

  const maskStyle: CSSProperties = {
    aspectRatio: `${asset.width} / ${asset.height}`,
    backgroundColor: 'var(--primary)',
    maskImage: `url(${asset.src})`,
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskImage: `url(${asset.src})`,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
  };

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={maskStyle}
      className={cn('inline-block shrink-0 bg-primary', className)}
    />
  );
}
