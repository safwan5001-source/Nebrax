'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  Globe,
  Layers3,
  LayoutDashboard,
  Paintbrush,
  Plug,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COMMERCE_WORKSPACE_NAV_GROUPS,
  isCommerceNavItemActive,
  type CommerceWorkspaceNavItem,
} from '@/modules/commerce-workspace/nav';
import {
  commerceWorkspaceMessage,
  type CommerceWorkspaceMessageKey,
} from '@/modules/commerce-workspace/messages';

const ICONS: Record<string, typeof Store> = {
  '/commerce': LayoutDashboard,
  '/commerce/stores': Store,
  '/commerce/published-products': ShoppingBag,
  '/commerce/appearance': Paintbrush,
  '/commerce/domains': Globe,
  '/commerce/delivery': Truck,
  '/commerce/integrations': Plug,
};

export function CommerceWorkspaceNav({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);

  return (
    <nav aria-label={t('navAriaLabel')} className={cn('space-y-4', className)}>
      {COMMERCE_WORKSPACE_NAV_GROUPS.map((group) => (
        <section key={group.labelKey} aria-label={t(group.labelKey as CommerceWorkspaceMessageKey)}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted">
            {t(group.labelKey as CommerceWorkspaceMessageKey)}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <WorkspaceLink
                key={item.href}
                item={item}
                pathname={pathname}
                label={t(item.labelKey as CommerceWorkspaceMessageKey)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

function WorkspaceLink({
  item,
  pathname,
  label,
  onNavigate,
}: {
  item: CommerceWorkspaceNavItem;
  pathname: string;
  label: string;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.href] ?? Layers3;
  const active = isCommerceNavItemActive(item.href, pathname);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'relative flex min-h-11 items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-primary-soft hover:text-primary',
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded bg-primary" />}
      <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
