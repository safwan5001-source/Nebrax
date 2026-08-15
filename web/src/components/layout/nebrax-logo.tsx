import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * شعار نبراكس الرسمي الملوّن بالأزرق المعتمد للعلامة.
 *
 * يبقى اللون جزءاً من الأصل البصري نفسه، لا من رموز ألوان الواجهة، حتى لا
 * تتغير هوية الشعار عند تبديل وضع العرض أو تعديل لون primary لاحقاً.
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
    <Image
      src="/brand/nebrax-logo.png"
      alt={alt}
      width={1026}
      height={680}
      priority={priority}
      sizes="(max-width: 640px) 72px, 96px"
      className={cn('h-auto w-auto object-contain', className)}
    />
  );
}
