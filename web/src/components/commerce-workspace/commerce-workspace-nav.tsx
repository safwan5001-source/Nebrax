'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { currentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';
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
  collapsed = false,
}: {
  onNavigate?: () => void;
  className?: string;
  collapsed?: boolean;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = (key: CommerceWorkspaceMessageKey) => commerceWorkspaceMessage(locale, key);
  const viewer = currentUser();
  const [hiddenAppKeys, setHiddenAppKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((res) => {
        if (cancelled || Array.isArray(res.data)) return;
        setHiddenAppKeys(hiddenApplicationKeys(res.data));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <nav aria-label={t('navAriaLabel')} className={cn('space-y-4', className)}>
      {COMMERCE_WORKSPACE_NAV_GROUPS.map((group) => (
        <section key={group.labelKey} aria-label={t(group.labelKey as CommerceWorkspaceMessageKey)}>
          {!collapsed && <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted">{t(group.labelKey as CommerceWorkspaceMessageKey)}</p>}
          <div className="space-y-1">
            {group.items.filter((item) => isNavEntryVisible(item, hiddenAppKeys, viewer)).map((item) => (
              <WorkspaceLink
                key={item.href}
                item={item}
                pathname={pathname}
                label={t(item.labelKey as CommerceWorkspaceMessageKey)}
                onNavigate={onNavigate}
                collapsed={collapsed}
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
  collapsed,
}: {
  item: CommerceWorkspaceNavItem;
  pathname: string;
  label: string;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  const Icon = ICONS[item.href] ?? Layers3;
  const active = isCommerceNavItemActive(item.href, pathname);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={cn(
        'group relative flex min-h-11 items-center gap-3 rounded py-2 text-sm transition-colors',
        collapsed ? 'justify-center px-2' : 'px-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-primary-soft hover:text-primary',
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded bg-primary" />}
      <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute start-full z-20 ms-2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-xs text-text opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {label}
        </span>
      )}
    </Link>
  );
}
