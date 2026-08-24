'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BellRing,
  ChartNoAxesCombined,
  Database,
  Fingerprint,
  Fuel,
  Gauge,
  Handshake,
  Network,
  ReceiptText,
  ShieldCheck,
  Settings2,
  Truck,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { type FuelWorkspaceNavItem, visibleFuelWorkspaceGroups } from '@/lib/fuel-workspace-nav';

const ICONS: Record<string, typeof Fuel> = {
  '/fuel-stations': Gauge,
  '/fuel-stations/shifts': Wrench,
  '/fuel-stations/sales': ReceiptText,
  '/fuel-stations/receiving': Truck,
  '/fuel-stations/master-data': Database,
  '/fuel-stations/corporate-contracts': Handshake,
  '/fuel-stations/avi-rfid': Fingerprint,
  '/fuel-stations/devices': Network,
  '/fuel-stations/maintenance': Wrench,
  '/fuel-stations/safety': ShieldCheck,
  '/fuel-stations/alerts': BellRing,
  '/fuel-stations/readiness': Gauge,
  '/fuel-stations/reports': ChartNoAxesCombined,
  '/fuel-stations/settings': Settings2,
};

/**
 * قائمة Fuel المتخصصة. سياسة الإظهار فيها عرض فقط؛ يبقى الخادم مرجع الصلاحيات
 * والتمكين، سواء عُرضت القائمة في الشريط الثابت أو درج الجوال.
 */
export function FuelWorkspaceNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const t = useTranslations('fuelWorkspaceNav');
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<string[]>(() => currentUser()?.permissions ?? []);
  const [hiddenAppKeys, setHiddenAppKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentUser()?.permissions?.length) return;
    api<{ user: { permissions?: string[] } }>('/me')
      .then((response) => setPermissions(response.user.permissions ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((response) => {
        if (cancelled || Array.isArray(response.data)) return;
        setHiddenAppKeys(new Set(Object.entries(response.data).filter(([, visible]) => !visible).map(([key]) => key)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const visibleGroups = useMemo(() => visibleFuelWorkspaceGroups(permissions, hiddenAppKeys), [hiddenAppKeys, permissions]);
  if (visibleGroups.length === 0) return null;

  return (
    <nav aria-label={t('ariaLabel')} className={cn('space-y-4', className)}>
      {visibleGroups.map((group) => (
        <section key={group.labelKey} aria-label={t(group.labelKey)}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted">{t(group.labelKey)}</p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <WorkspaceLink
                key={item.href}
                item={item}
                pathname={pathname}
                label={t(item.labelKey)}
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
  item: FuelWorkspaceNavItem;
  pathname: string;
  label: string;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.href] ?? Fuel;
  const active = item.href === '/fuel-stations' ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

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
