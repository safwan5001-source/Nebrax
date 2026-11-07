'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Cylinder, Droplets, Gauge, House, ShieldCheck, Truck, UserRound, WifiOff, type LucideIcon } from 'lucide-react';
import { isStationSession } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { StationOpsProvider, useStationOps } from './context';
import { isNavActive, visibleOpsNav, type OpsNavId } from './nav';

const NAV_ICONS: Record<OpsNavId, LucideIcon> = { home: House, products: Droplets, shifts: Gauge, receiving: Truck, tanks: Cylinder, manage: ShieldCheck, profile: UserRound };

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** حالة الاتصال: لا نعد بمزامنة ولا نخفي أن البيانات قد تكون قديمة. */
function OfflineBanner() {
  const t = useTranslations('stationOps');
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-[color:var(--fo-warning-tint)] px-4 py-2 text-sm text-warning">
      <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span>{t('offlineBanner')}</span>
    </div>
  );
}

/**
 * الإطار: قماش + تنقل سفلي (شريط جانبي من `md`). الرأس الكحلي تملكه كل شاشة (`HomeMasthead`/`PageMasthead`) فلا رأس
 * لاصق يستهلك مساحة الجوال، ولا شريطان ثابتان متراكبان: التنقل السفلي وحده ثابت، وجسم الشاشة يحجز ارتفاعه + المنطقة الآمنة.
 */
function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('stationOps');
  const pathname = usePathname();
  const { can } = useStationOps();
  const items = visibleOpsNav((permissions) => permissions.every((permission) => can(permission)), { pinSession: isStationSession() });

  return (
    <div data-fuel-ops="" className="fo-root min-h-screen bg-background text-text [min-height:100dvh] md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#fo-main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3">
        {t('skipToContent')}
      </a>

      <nav
        aria-label={t('navLabel')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:border-e md:border-t-0 md:pb-0"
      >
        <ul className="mx-auto flex max-w-xl justify-around px-1 pt-1.5 md:max-w-none md:flex-col md:gap-1 md:p-3">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.id} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-[11px] sm:px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm',
                    active ? 'font-bold text-primary md:bg-primary-soft' : 'font-medium text-muted hover:text-text',
                  )}
                >
                  <Icon aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.7} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col md:col-start-2">
        <OfflineBanner />
        {children}
      </div>
    </div>
  );
}

export function StationOpsShell({ children }: { children: ReactNode }) {
  return (
    <StationOpsProvider>
      <Frame>{children}</Frame>
    </StationOpsProvider>
  );
}
