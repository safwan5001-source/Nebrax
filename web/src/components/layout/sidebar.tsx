'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, FileText, Users, Wallet, BarChart3, ShoppingCart, RotateCcw, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: LucideIcon;
  key: 'dashboard' | 'invoices' | 'purchases' | 'returns' | 'partners' | 'payments' | 'reports';
  enabled: boolean;
}

const ITEMS: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'dashboard', enabled: true },
  { href: '/invoices', icon: FileText, key: 'invoices', enabled: true },
  { href: '/purchases', icon: ShoppingCart, key: 'purchases', enabled: true },
  { href: '/returns', icon: RotateCcw, key: 'returns', enabled: true },
  { href: '/partners', icon: Users, key: 'partners', enabled: true },
  { href: '/payments', icon: Wallet, key: 'payments', enabled: true },
  { href: '/reports', icon: BarChart3, key: 'reports', enabled: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <aside className="flex w-[84px] shrink-0 flex-col items-center gap-1 border-e border-border bg-surface py-4">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-bold text-white">
        نـ
      </div>
      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          const content = (
            <div
              className={cn(
                'group relative flex h-11 w-12 items-center justify-center rounded',
                item.enabled ? 'text-muted hover:bg-primary-soft hover:text-primary' : 'cursor-not-allowed text-muted/40',
                active && 'bg-primary-soft text-primary'
              )}
            >
              {active && <span className="absolute inset-y-2 start-0 w-0.5 rounded bg-primary" />}
              <Icon className="h-5 w-5" strokeWidth={1.7} />
              <span className="pointer-events-none absolute start-full z-10 ms-2 hidden whitespace-nowrap rounded bg-text px-2 py-1 text-xs text-background group-hover:block">
                {t(item.key)}
                {!item.enabled && ` · ${t('soon')}`}
              </span>
            </div>
          );
          return item.enabled ? (
            <Link key={item.key} href={item.href}>
              {content}
            </Link>
          ) : (
            <div key={item.key}>{content}</div>
          );
        })}
      </nav>
    </aside>
  );
}
