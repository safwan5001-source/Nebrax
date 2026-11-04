'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, Clock } from 'lucide-react';
import { useStationOps } from './context';
import { useCurrentShift, useStationAssets, useStationPrices } from './data';
import { COMING_SOON, OPS_BASE, deriveOpsMode } from './nav';
import { PriceLabel } from './price-label';
import { ShiftCard } from './shift-card';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import type { Station } from './schemas';

function CurrentShiftSection({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const current = useCurrentShift(station);

  return (
    <section aria-labelledby="fo-shift-h" className="space-y-3">
      <h2 id="fo-shift-h" className="text-lg font-semibold text-text">{t('home.currentShift')}</h2>
      {!current.allowed ? (
        <EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} />
      ) : current.state.status === 'loading' ? (
        <LoadingBlock rows={1} />
      ) : current.state.status === 'error' ? (
        <ErrorState error={current.state.error} onRetry={current.reload} />
      ) : current.state.data.shift ? (
        <>
          <ShiftCard shift={current.state.data.shift} />
          {current.state.data.multiple ? <InlineNote tone="warning">{t('shift.multipleOpen')}</InlineNote> : null}
        </>
      ) : (
        <EmptyState title={t('shift.none.title')} body={t('shift.none.body')} />
      )}
    </section>
  );
}

function ProductsSection({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const assets = useStationAssets(station);
  const productIds = assets.catalog?.products.map((entry) => entry.product.id) ?? [];
  const prices = useStationPrices(station, productIds);

  return (
    <section aria-labelledby="fo-products-h" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="fo-products-h" className="text-lg font-semibold text-text">{t('home.products')}</h2>
        <Link href={`${OPS_BASE}/products`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {t('home.allProducts')}
          <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.8} />
        </Link>
      </div>

      {assets.state.status === 'loading' ? (
        <LoadingBlock rows={3} />
      ) : assets.state.status === 'error' ? (
        <ErrorState error={assets.state.error} onRetry={assets.reload} />
      ) : assets.catalog && assets.catalog.products.length > 0 ? (
        <>
          <ul className="space-y-3">
            {assets.catalog.products.map((entry) => (
              <li key={entry.product.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text">{entry.product.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
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
        <EmptyState title={t('products.none.title')} body={t('products.none.body')} />
      )}
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
      <h2 id="fo-soon-h" className="text-lg font-semibold text-text">{t('home.comingSoon')}</h2>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
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

export function HomeScreen() {
  const t = useTranslations('stationOps');
  const { viewer, can } = useStationOps();
  const mode = deriveOpsMode(can);

  return (
    <>
      <div>
        <h1 className="text-[1.4rem] font-bold leading-8 text-text">{t('home.greeting', { name: viewer.name })}</h1>
        <p className="mt-1 text-sm text-muted">{t(`mode.${mode}`)}</p>
      </div>
      <StationGate>
        {(station) => (
          <>
            <CurrentShiftSection station={station} />
            <ProductsSection station={station} />
            <ComingSoon />
          </>
        )}
      </StationGate>
    </>
  );
}
