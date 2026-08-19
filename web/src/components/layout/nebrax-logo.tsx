import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * شعار نبراكس الرسمي بدرجتين معتمدتين من الهوية.
 *
 * يظهر الأزرق العميق (#1E40AF) في الوضع الفاتح، والأزرق الفاتح (#4F8CFF)
 * في الوضع الداكن. تعتمد كل نسخة على شفافية الأصل نفسه بلا خلفية أو إطار،
 * ولا تُغيّر رموز ألوان الواجهة أو متغيرات الثيم.
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
  return (
    <>
      <Image
        src="/brand/nebrax-logo.png"
        alt={alt}
        width={1026}
        height={680}
        priority={priority}
        sizes="(max-width: 640px) 72px, 96px"
        className={cn('h-auto w-auto object-contain dark:hidden', className)}
      />
      <Image
        src="/brand/nebrax-logo-dark.png"
        alt={alt}
        width={1026}
        height={680}
        priority={priority}
        sizes="(max-width: 640px) 72px, 96px"
        className={cn('hidden h-auto w-auto object-contain dark:block', className)}
      />
    </>
  );
}
