'use client';

import { useLocale } from 'next-intl';
import { BRAND, getBrandName } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Wordmark مركزي لهوية أَوْج / AWJ.
 * يعتمد على typography وtokens الحالية حتى تبقى الهوية متسقة في RTL/LTR
 * والوضعين الفاتح والداكن، من دون ربط اسم المنتج بشعار شركة العميل.
 * يمكن استبدال محتوى هذا المكوّن بأصل الشعار النهائي لاحقاً من نقطة واحدة.
 */
export function AwjLogo({
  alt,
  className,
  priority = false,
}: {
  alt?: string;
  className?: string;
  /** محفوظ لتوافق واجهة مكوّن الشعار السابقة. */
  priority?: boolean;
}) {
  const locale = useLocale();
  const name = getBrandName(locale);
  void priority;

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      title={alt ? BRAND.displayName : undefined}
      className={cn(
        'inline-flex shrink-0 items-center font-sans text-[1.65rem] font-bold leading-none tracking-tight text-primary',
        locale === 'en' && 'tracking-[0.08em]',
        className,
      )}
    >
      {name}
    </span>
  );
}
