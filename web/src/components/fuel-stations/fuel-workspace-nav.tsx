'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Database,
  Fingerprint,
  Fuel,
  Gauge,
  Handshake,
  Network,
  ReceiptText,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
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
  '/fuel-stations/readiness': ShieldCheck,
};

export function FuelWorkspaceNav() {
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
    <nav aria-label={t('ariaLabel')} className="rounded-md border border-border bg-surface">
      <div className="hidden divide-y divide-border lg:block">
        {visibleGroups.map((group) => (
          <div key={group.labelKey} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 px-4 py-3">
            <p className="pt-2 text-xs font-semibold tracking-wide text-muted">{t(group.labelKey)}</p>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => <WorkspaceLink key={item.href} item={item} pathname={pathname} label={t(item.labelKey)} />)}
            </div>
          </div>
        ))}
      </div>

      <details className="group lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text marker:hidden">
          <span>{t('workspaceNavigation')}</span>
          <span className="text-xs font-normal text-muted group-open:hidden">{t('expand')}</span>
          <span className="hidden text-xs font-normal text-muted group-open:inline">{t('collapse')}</span>
        </summary>
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-4">
            {visibleGroups.map((group) => (
              <section key={group.labelKey} aria-label={t(group.labelKey)}>
                <p className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted">{t(group.labelKey)}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {group.items.map((item) => <WorkspaceLink key={item.href} item={item} pathname={pathname} label={t(item.labelKey)} />)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </details>
    </nav>
  );
}

function WorkspaceLink({ item, pathname, label }: { item: FuelWorkspaceNavItem; pathname: string; label: string }) {
  const Icon = ICONS[item.href] ?? Fuel;
  const active = item.href === '/fuel-stations' ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-muted'}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span>{label}</span>
    </Link>
  );
}
