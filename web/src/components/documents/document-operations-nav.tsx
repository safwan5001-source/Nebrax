'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export function DocumentOperationsNav() {
  const t = useTranslations('documentOperations');
  const pathname = usePathname();
  const links = [
    { href: '/documents', label: t('navReview') },
    { href: '/documents/operations', label: t('navOperations') },
    { href: '/documents/usage', label: t('navUsage') },
    { href: '/documents/governance', label: t('navGovernance') },
    { href: '/documents/settings', label: t('navSettings') },
  ];

  return (
    <nav aria-label={t('title')} className="overflow-x-auto border-b border-border">
      <div className="flex min-w-max gap-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-t px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active ? 'border-b-2 border-primary text-primary' : 'text-muted hover:bg-surface hover:text-text',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
