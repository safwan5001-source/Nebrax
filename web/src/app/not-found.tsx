'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * صفحة «غير موجود» بلغة الواجهة ومعلَمٍ رئيسي (ERP-UX-023). صفحة Next الافتراضية كانت
 * إنجليزية فقط، بلا `main`، وبلا طريق عودة إلى مساحة العمل.
 *
 * عنوانٌ مجهول تحت `/platform` يعود إلى لوحة المنصة لا إلى لوحة ERP: جلسة مدير المنصة
 * منفصلة، و`/dashboard` كان سيحيله إلى دخول ERP بدل منصّته.
 */
export default function NotFound() {
  const t = useTranslations('notFound');
  const pathname = usePathname() ?? '';
  const platform = pathname === '/platform' || pathname.startsWith('/platform/');
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 [min-height:100dvh]">
      <div className="max-w-md text-center">
        <p className="num text-sm font-medium text-muted">404</p>
        <h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('body')}</p>
        <Link
          href={platform ? '/platform' : '/dashboard'}
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
        >
          {platform ? t('backPlatform') : t('back')}
        </Link>
      </div>
    </main>
  );
}
