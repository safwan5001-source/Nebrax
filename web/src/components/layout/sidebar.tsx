'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  FileText,
  Store,
  Percent,
  CalendarClock,
  Target,
  QrCode,
  Users,
  Award,
  BadgeCheck,
  Coins,
  ShieldCheck,
  Package,
  ShoppingCart,
  Handshake,
  Repeat,
  ClipboardCheck,
  Warehouse,
  BookOpen,
  Receipt,
  Building2,
  Network,
  ScrollText,
  UserCog,
  Fingerprint,
  Banknote,
  FileSignature,
  Inbox,
  Wrench,
  Workflow,
  CalendarCheck,
  Building,
  KeyRound,
  Timer,
  Factory,
  Truck,
  Send,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: LucideIcon;
  key: string;
  /** الوحدات الجاهزة لها شاشة؛ غيرها رابط بشارة «قريباً» حتى تُبنى. */
  built?: boolean;
}

interface NavGroup {
  /** مفتاح عنوان المجموعة تحت nav.groups */
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'sales',
    items: [
      { href: '/invoices', icon: FileText, key: 'invoices', built: true },
      { href: '/pos', icon: Store, key: 'pos', built: true },
      { href: '/discounts', icon: Percent, key: 'discounts' },
      { href: '/installments', icon: CalendarClock, key: 'installments' },
      { href: '/commissions', icon: Target, key: 'commissions' },
      { href: '/zatca', icon: QrCode, key: 'einvoice' },
    ],
  },
  {
    title: 'customers',
    items: [
      { href: '/partners', icon: Users, key: 'partners', built: true },
      { href: '/loyalty', icon: Award, key: 'loyalty' },
      { href: '/memberships', icon: BadgeCheck, key: 'memberships' },
      { href: '/balances', icon: Coins, key: 'balances' },
      { href: '/insurance', icon: ShieldCheck, key: 'insurance' },
    ],
  },
  {
    title: 'inventory',
    items: [
      { href: '/products', icon: Package, key: 'products' },
      { href: '/purchases', icon: ShoppingCart, key: 'purchases', built: true },
      { href: '/suppliers', icon: Handshake, key: 'suppliers' },
      { href: '/purchase-cycle', icon: Repeat, key: 'purchaseCycle' },
      { href: '/stock-permits', icon: ClipboardCheck, key: 'stockPermits' },
      { href: '/stocktaking', icon: Warehouse, key: 'stocktaking' },
    ],
  },
  {
    title: 'accounting',
    items: [
      { href: '/accounts', icon: BookOpen, key: 'accounts' },
      { href: '/expenses', icon: Receipt, key: 'expenses' },
      { href: '/assets', icon: Building2, key: 'assets' },
      { href: '/cost-centers', icon: Network, key: 'costCenters' },
      { href: '/cheques', icon: ScrollText, key: 'cheques' },
    ],
  },
  {
    title: 'hr',
    items: [
      { href: '/hr', icon: UserCog, key: 'employees', built: true },
      { href: '/attendance', icon: Fingerprint, key: 'attendance' },
      { href: '/payroll', icon: Banknote, key: 'payroll' },
      { href: '/contracts', icon: FileSignature, key: 'contracts' },
      { href: '/requests', icon: Inbox, key: 'requests' },
    ],
  },
  {
    title: 'operations',
    items: [
      { href: '/work-orders', icon: Wrench, key: 'workOrders' },
      { href: '/workflow', icon: Workflow, key: 'workflow' },
      { href: '/bookings', icon: CalendarCheck, key: 'bookings' },
      { href: '/rentals', icon: Building, key: 'rentals' },
      { href: '/leases', icon: KeyRound, key: 'leases' },
      { href: '/time-tracking', icon: Timer, key: 'timeTracking' },
      { href: '/manufacturing', icon: Factory, key: 'manufacturing' },
    ],
  },
  {
    title: 'logistics',
    items: [
      { href: '/fleet', icon: Truck, key: 'fleet' },
      { href: '/shipping', icon: Send, key: 'shipping' },
    ],
  },
  {
    title: 'system',
    items: [
      { href: '/reports', icon: BarChart3, key: 'reports', built: true },
      { href: '/settings', icon: Settings, key: 'settings', built: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="no-print flex w-60 shrink-0 flex-col border-e border-border bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-bold text-white">
          نـ
        </div>
        <span className="text-sm font-semibold text-text">نبراس</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <Link
          href="/dashboard"
          className={cn(
            'relative mb-3 flex h-9 items-center gap-2.5 rounded px-2.5 text-sm text-muted hover:bg-primary-soft hover:text-primary',
            isActive('/dashboard') && 'bg-primary-soft font-medium text-primary'
          )}
        >
          {isActive('/dashboard') && (
            <span className="absolute inset-y-1.5 start-0 w-0.5 rounded bg-primary" />
          )}
          <LayoutDashboard className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
          {t('dashboard')}
        </Link>

        {GROUPS.map((group) => (
          <div key={group.title} className="mb-3">
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted/70">
              {t(`groups.${group.title}`)}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={cn(
                      'relative flex h-9 items-center gap-2.5 rounded px-2.5 text-sm text-muted hover:bg-primary-soft hover:text-primary',
                      active && 'bg-primary-soft font-medium text-primary'
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 start-0 w-0.5 rounded bg-primary" />
                    )}
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                    <span className="truncate">{t(item.key)}</span>
                    {!item.built && (
                      <span className="ms-auto shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                        {t('soon')}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
