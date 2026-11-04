'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Droplets, Gauge, House, Settings, UserRound, WifiOff, type LucideIcon } from 'lucide-react';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { useCompany } from '@/lib/company';
import { cn } from '@/lib/utils';
import { StationOpsProvider, useStationOps } from './context';
import { OPS_BASE, deriveOpsMode, isNavActive, visibleOpsNav, type OpsNavId } from './nav';

const NAV_ICONS: Record<OpsNavId, LucideIcon> = { home: House, products: Droplets, shifts: Gauge, profile: UserRound };

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** حالة الاتصال: القراءة فقط تبقى ممكنة من الشاشة الحالية لكن لا نعد بمزامنة ولا نخفي أن البيانات قد تكون قديمة. */
function OfflineBanner() {
  const t = useTranslations('stationOps');
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-warning/15 px-4 py-2 text-sm text-warning">
      <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span>{t('offlineBanner')}</span>
    </div>
  );
}

/** هوية المستأجر من إعدادات أَوْج؛ بدونها شارة AWJ محايدة (لا شعار مستأجر آخر ولا اسم ثابت). */
function TenantMark() {
  const company = useCompany();
  if (company?.logo) {
    return <img src={company.logo} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-[color:var(--fo-logo-bg)] object-contain p-0.5" />;
  }
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--fo-accent)] text-xs font-bold text-[var(--fo-navy)]">
      AWJ
    </span>
  );
}

function StationBar() {
  const t = useTranslations('stationOps');
  const { stations, selectedStation, selectStation } = useStationOps();

  if (stations.status === 'loading') {
    return <div className="h-11 animate-pulse rounded-lg bg-border/60" aria-hidden="true" />;
  }
  if (stations.status !== 'success' || !selectedStation) return null;

  const list = stations.data;
  const inactive = selectedStation.status !== 'active';

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="fo-station" className="sr-only">{t('stationLabel')}</label>
      {list.length > 1 ? (
        <select
          id="fo-station"
          value={selectedStation.id}
          onChange={(event) => selectStation(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {list.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}{station.status !== 'active' ? ` · ${t('stationInactive')}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div id="fo-station" className="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-border bg-surface px-3 text-base text-text">
          <span className="truncate">{selectedStation.name}</span>
        </div>
      )}
      {inactive ? <span className="shrink-0 rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">{t('stationInactive')}</span> : null}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('stationOps');
  const pathname = usePathname();
  const company = useCompany();
  const { can, viewer } = useStationOps();
  const items = visibleOpsNav((permissions) => permissions.every((permission) => can(permission)));
  const mode = deriveOpsMode(can);

  return (
    <div data-fuel-ops="" className="fo-root min-h-screen bg-background text-text [min-height:100dvh] md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#fo-main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3">
        {t('skipToContent')}
      </a>

      <nav
        aria-label={t('navLabel')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:row-span-2 md:border-e md:border-t-0 md:pb-0"
      >
        <ul className="mx-auto flex max-w-xl md:max-w-none md:flex-col md:gap-1 md:p-3">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.id} className="flex-1 md:flex-none">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm',
                    active ? 'text-primary md:bg-primary-soft' : 'text-muted hover:text-text',
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.1 : 1.7} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col md:col-start-2">
        <header className="sticky top-0 z-20 border-b border-[color:var(--fo-header-line)] bg-[var(--fo-navy)] text-[color:var(--fo-on-navy)] [padding-top:env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
            <TenantMark />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold leading-5">{t('productName')}</p>
              <p className="truncate text-xs leading-5 text-[color:var(--fo-on-navy-muted)]">{company?.name ?? t('workspaceName')}</p>
            </div>
            <div className="fo-header-actions flex items-center">
              <LangToggle />
              <ThemeToggle />
              <Link
                href={`${OPS_BASE}/settings`}
                aria-label={t('navSettings')}
                className="grid h-11 w-11 place-items-center rounded-lg hover:bg-[color:var(--fo-header-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--fo-on-navy)]"
              >
                <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
              </Link>
            </div>
          </div>
          <div className="mx-auto max-w-3xl px-4 pb-3">
            <StationBar />
          </div>
        </header>

        <OfflineBanner />

        <main id="fo-main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 outline-none md:pb-8">
          <p className="sr-only">{t(`mode.${mode}`)} · {viewer.name}</p>
          {children}
        </main>
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
