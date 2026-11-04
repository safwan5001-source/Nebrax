'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronRight, Clock, CreditCard, Droplets, Gauge, Settings, Wallet } from 'lucide-react';
import { useStationOps } from './context';
import { useCurrentShift, useStationAssets, useStationPrices } from './data';
import { formatLitersNumberFromText } from './format';
import { HomeMasthead, ScreenBody } from './masthead';
import { COMING_SOON, OPS_BASE, deriveOpsMode } from './nav';
import { PriceLabel } from './price-label';
import { CurrentShiftBanner, FinancialSummary, MetricCard } from './shift-card';
import { StationGate } from './station-gate';
import { ErrorState, InlineNote, LoadingBlock } from './state-views';
import type { Station } from './schemas';

function ShiftAndSummary({ station, productCount, pumpCount }: { station: Station; productCount: number | null; pumpCount: number | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const current = useCurrentShift(station);
  const shift = current.state.status === 'success' ? current.state.data.shift : null;
  const count = (value: number | null) => (value === null ? '—' : String(value));

  let banner: React.ReactNode = null;
  if (!current.allowed) {
    banner = (
      <div className="mt-2">
        <p className="text-base font-semibold text-text">{t('shift.noPermission.title')}</p>
        <p className="mt-0.5 text-sm leading-6 text-muted">{t('shift.noPermission.body')}</p>
      </div>
    );
  } else if (current.state.status === 'loading') {
    banner = <div role="status" aria-busy="true" className="mt-3 space-y-2"><span className="sr-only">{t('loading')}</span><div className="h-6 w-32 animate-pulse rounded bg-border/60" /><div className="h-4 w-48 animate-pulse rounded bg-border/60" /></div>;
  } else if (current.state.status === 'error') {
    banner = <div className="mt-3"><ErrorState error={current.state.error} onRetry={current.reload} /></div>;
  } else if (!shift) {
    banner = (
      <div className="mt-2">
        <p className="text-base font-semibold text-text">{t('shift.none.title')}</p>
        <p className="mt-0.5 text-sm leading-6 text-muted">{t('shift.none.body')}</p>
      </div>
    );
  }

  return (
    <>
      <CurrentShiftBanner shift={shift} timeZone={station.timezone}>
        {banner}
        {current.state.status === 'success' && current.state.data.multiple ? <div className="mt-3"><InlineNote tone="warning">{t('shift.multipleOpen')}</InlineNote></div> : null}
      </CurrentShiftBanner>

      <div className="space-y-3 pt-1">
        <h2 className="text-base font-semibold text-text">{t('home.summary')}</h2>
        <FinancialSummary
          caption={t('home.summaryLiters')}
          value={shift ? formatLitersNumberFromText(shift.operational_liters, locale) : null}
          unit={t('unit.liter')}
          cells={[
            { label: t('home.cellProducts'), value: count(productCount) },
            { label: t('home.cellPumps'), value: count(pumpCount) },
          ]}
        />
        <div className="grid grid-cols-2 gap-2.5 !mt-2.5">
          <MetricCard label={t('metric.cash')} value={null} note={t('metric.unavailable')} icon={<Wallet aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />} />
          <MetricCard label={t('metric.card')} value={null} note={t('metric.unavailable')} icon={<CreditCard aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />} />
        </div>
      </div>
    </>
  );
}

function ProductsSection({ station, assets }: { station: Station; assets: ReturnType<typeof useStationAssets> }) {
  const t = useTranslations('stationOps');
  const productIds = assets.catalog?.products.map((entry) => entry.product.id) ?? [];
  const prices = useStationPrices(station, productIds);

  return (
    <section aria-labelledby="fo-products-h" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="fo-products-h" className="text-base font-semibold text-text">{t('home.products')}</h2>
        <Link href={`${OPS_BASE}/products`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t('home.allProducts')}
          <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.8} />
        </Link>
      </div>

      {assets.state.status === 'loading' ? (
        <LoadingBlock rows={2} />
      ) : assets.state.status === 'error' ? (
        <ErrorState error={assets.state.error} onRetry={assets.reload} />
      ) : assets.catalog && assets.catalog.products.length > 0 ? (
        <>
          <ul className="space-y-2.5">
            {assets.catalog.products.map((entry) => (
              <li key={entry.product.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-surface p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text">{entry.product.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {t('home.pumpsNozzles', { pumps: String(entry.pumpIds.length), nozzles: String(entry.nozzles.length) })}
                  </p>
                </div>
                <PriceLabel allowed={prices.allowed} state={prices.state} productId={entry.product.id} />
              </li>
            ))}
          </ul>
          {assets.catalog.unmappedProducts.length > 0 ? (
            <InlineNote>{t('home.unmapped', { count: String(assets.catalog.unmappedProducts.length) })}</InlineNote>
          ) : null}
        </>
      ) : (
        <div className="rounded-[14px] border border-dashed border-border p-4">
          <p className="text-base font-semibold text-text">{t('products.none.title')}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{t('products.none.body')}</p>
        </div>
      )}
    </section>
  );
}

function Shortcuts() {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const items = [
    { href: `${OPS_BASE}/products`, label: t('home.shortcuts.products'), Icon: Droplets, show: true },
    { href: `${OPS_BASE}/shifts`, label: t('home.shortcuts.shifts'), Icon: Gauge, show: can('fuel.shift.view') },
    { href: `${OPS_BASE}/settings`, label: t('home.shortcuts.settings'), Icon: Settings, show: true },
  ].filter((item) => item.show);
  return (
    <ul className="grid grid-cols-3 gap-2.5">
      {items.map(({ href, label, Icon }) => (
        <li key={href}>
          <Link href={href} className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-[13px] border border-border bg-surface px-1.5 py-3 text-center text-xs font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.6} />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** الإجراء التالي المسموح: إكمال الوردية في شاشة أَوْج الكاملة (الفعلية) — لا زر يدّعي ما لم يُنفَّذ بعد. */
function NextAction() {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const allowed = can('fuel.shift.view') && can('fuel_stations.view');
  return (
    <section aria-labelledby="fo-actions-h" className="space-y-3">
      <h2 id="fo-actions-h" className="text-base font-semibold text-text">{t('home.actions')}</h2>
      {allowed ? (
        <Link
          href="/fuel-stations/shifts"
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t('home.cta')}
          <ArrowLeft aria-hidden="true" className="h-5 w-5 rtl:rotate-0 ltr:rotate-180" strokeWidth={2} />
        </Link>
      ) : null}
      <p className="text-xs leading-6 text-muted">{t('home.ctaNote')}</p>
      <Shortcuts />
    </section>
  );
}

function ComingSoon() {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const keys = COMING_SOON[deriveOpsMode(can)];
  if (keys.length === 0) return null;
  return (
    <section aria-labelledby="fo-soon-h" className="space-y-3">
      <h2 id="fo-soon-h" className="text-base font-semibold text-text">{t('home.comingSoon')}</h2>
      <ul className="divide-y divide-border rounded-[14px] border border-border bg-surface">
        {keys.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 px-4 py-3 text-muted">
            <span className="text-sm">{t(`soon.${key}`)}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
              <Clock aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
              {t('soonBadge')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Body({ station }: { station: Station }) {
  const assets = useStationAssets(station);
  const catalog = assets.catalog;
  const pumpCount = catalog ? catalog.pumps.filter(({ nozzles }) => nozzles.some((view) => view.blockedBy === null)).length : null;
  return (
    <div className="space-y-5">
      <ShiftAndSummary station={station} productCount={catalog ? catalog.products.length : null} pumpCount={pumpCount} />
      <NextAction />
      <ProductsSection station={station} assets={assets} />
      <ComingSoon />
    </div>
  );
}

export function HomeScreen() {
  return (
    <>
      <HomeMasthead />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Body station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
