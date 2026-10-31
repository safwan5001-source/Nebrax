'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { useOptionalCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { commonMessages } from '../messages/common';
import { WHOLESALE_SECTIONS, isWholesaleSectionActive } from '../nav';

/**
 * Section bar of the Wholesale workspace. Horizontally scrollable on phones (no wrapping, no truncated labels hidden
 * behind overflow without a scroll affordance), links carry the active store so a new tab opens the same store.
 */
export function WholesaleSubnav({ className }: { className?: string }) {
  const locale = useLocale();
  const { t } = commonMessages.forLocale(locale);
  const pathname = usePathname();
  const storeId = useOptionalCommerceStoreContext()?.selectedStoreId ?? null;

  return (
    <nav aria-label={t('sectionsAria')} className={cn('-mx-1 overflow-x-auto px-1 pb-px', className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {WHOLESALE_SECTIONS.map((section) => {
          const active = isWholesaleSectionActive(section.href, pathname);
          return (
            <li key={section.key}>
              <Link
                href={withStoreParam(section.href, storeId)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 items-center whitespace-nowrap px-3 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                  active ? 'font-medium text-primary' : 'text-muted hover:text-text',
                )}
              >
                {t(`section.${section.key}` as 'section.overview')}
                {active ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-primary" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
