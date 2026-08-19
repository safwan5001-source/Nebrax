'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

const LOGO_ASSETS = {
  ar: {
    light: '/brand/nebrax-logo.png',
    dark: '/brand/nebrax-logo-dark.png',
    width: 1026,
    height: 680,
  },
  en: {
    light: '/brand/nebrax-logo-en.png',
    dark: '/brand/nebrax-logo-en-dark.png',
    width: 1466,
    height: 959,
  },
} as const;

/**
 * شعار نبراكس المتكيف مع اللغة ووضع العرض.
 *
 * العربية تعرض الشعار العربي وحده والإنجليزية تعرض شعار NEBRAX وحده. لكل لغة
 * أصل فاتح باللون #1E40AF وأصل داكن باللون #4F8CFF، من دون خلفية أو إطار.
 */
export function NebraxLogo({
  alt = '',
  className,
  priority = false,
}: {
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const locale = useLocale();
  const assets = locale === 'en' ? LOGO_ASSETS.en : LOGO_ASSETS.ar;

  return (
    <>
      <Image
        src={assets.light}
        alt={alt}
        width={assets.width}
        height={assets.height}
        priority={priority}
        sizes="(max-width: 640px) 72px, 96px"
        className={cn('h-auto w-auto object-contain dark:hidden', className)}
      />
      <Image
        src={assets.dark}
        alt={alt}
        width={assets.width}
        height={assets.height}
        priority={priority}
        sizes="(max-width: 640px) 72px, 96px"
        className={cn('hidden h-auto w-auto object-contain dark:block', className)}
      />
    </>
  );
}
