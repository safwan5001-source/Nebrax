'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { EmptyState, PageHeader } from '@/components/nebrax';
import { commerceWorkspaceMessage, type CommerceWorkspaceMessageKey } from '@/modules/commerce-workspace/messages';

const CORE_LINKS = [
  { href: '/products', labelKey: 'coreProducts' as const },
  { href: '/partners', labelKey: 'coreCustomers' as const },
  { href: '/inventory', labelKey: 'coreInventory' as const },
  { href: '/invoices', labelKey: 'coreInvoices' as const },
];

export function CommerceDestinationPage({
  titleKey,
  showCoreLinks = false,
}: {
  titleKey: CommerceWorkspaceMessageKey;
  showCoreLinks?: boolean;
}) {
  const locale = useLocale();
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('title')}
        title={t(titleKey)}
        description={titleKey === 'overviewTitle' ? t('overviewDescription') : t('destinationPending')}
      />
      <EmptyState title={t('destinationPending')} surface="panel" />
      {showCoreLinks ? (
        <section className="rounded border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{t('coreLinksTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('coreLinksHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CORE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center rounded border border-border px-3 text-sm text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t(link.labelKey)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
