'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useStationOps } from './context';
import { useStationAssets, useStationPrices } from './data';
import type { NozzleView } from './catalog';
import { formatLitersNumberFromMl } from './format';
import { Quantity } from './quantity';
import { PriceLabel } from './price-label';
import { PageMasthead, ScreenBody } from './masthead';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';
import type { Station } from './schemas';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-[color:var(--fo-positive-tint)] text-positive',
  maintenance: 'bg-[color:var(--fo-warning-tint)] text-warning',
  inactive: 'border border-border text-muted',
};

function AssetStatus({ status }: { status: string }) {
  const t = useTranslations('stationOps');
  const known = status === 'active' || status === 'maintenance' || status === 'inactive';
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? 'border border-border text-muted'}`}>
      {known ? t(`assetStatus.${status}`) : status}
    </span>
  );
}

function NozzleRow({ view, showPump = true }: { view: NozzleView; showPump?: boolean }) {
  const t = useTranslations('stationOps');
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-text">
          {t('products.nozzle')} <span className="num">{view.nozzle.nozzle_number}</span>
          {showPump && view.pump ? <span className="text-muted"> · {t('products.pump')} <span className="num">{view.pump.pump_number}</span></span> : null}
        </p>
        <p className="mt-0.5 text-muted">
          {view.product?.name ?? t('products.unknownProduct')}
          {view.tank ? ` · ${view.tank.name}` : ''}
        </p>
        {view.blockedBy ? <p className="mt-1 text-warning">{t(`blocked.${view.blockedBy}`)}</p> : null}
      </div>
      <AssetStatus status={view.nozzle.status} />
    </li>
  );
}

function Content({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { can } = useStationOps();
  const assets = useStationAssets(station);
  const productIds = assets.catalog?.products.map((entry) => entry.product.id) ?? [];
  const prices = useStationPrices(station, productIds);

  if (assets.state.status === 'loading') return <LoadingBlock rows={4} />;
  if (assets.state.status === 'error') return <ErrorState error={assets.state.error} onRetry={assets.reload} />;
  const catalog = assets.catalog;
  if (!catalog) return null;
  const canSeeRegistryGaps = can('fuel_stations.manage');

  return (
    <>
      <section aria-labelledby="fo-dispensable-h" className="space-y-3">
        <h2 id="fo-dispensable-h" className="text-base font-semibold text-text">{t('products.dispensable')}</h2>
        {catalog.products.length === 0 ? (
          <EmptyState title={t('products.none.title')} body={t('products.none.body')} />
        ) : (
          <ul className="space-y-3">
            {catalog.products.map((entry) => (
              <li key={entry.product.id}>
                <details className="group rounded-[14px] border border-border bg-surface open:shadow-sm">
                  <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-text">{entry.product.name}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {t('home.pumpsNozzles', { pumps: String(entry.pumpIds.length), nozzles: String(entry.nozzles.length) })}
                      </span>
                    </span>
                    <PriceLabel allowed={prices.allowed} state={prices.state} productId={entry.product.id} />
                  </summary>
                  <ul className="divide-y divide-border border-t border-border px-4">
                    {entry.nozzles.map((view) => <NozzleRow key={view.nozzle.id} view={view} />)}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        {catalog.unmappedProducts.length > 0 ? (
          <div className="rounded-[14px] border border-dashed border-border p-4">
            <InlineNote>{t('home.unmapped', { count: String(catalog.unmappedProducts.length) })}</InlineNote>
            {canSeeRegistryGaps ? (
              <ul className="mt-2 list-inside list-disc text-sm text-muted">
                {catalog.unmappedProducts.map((product) => <li key={product.id}>{product.name}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="fo-pumps-h" className="space-y-3">
        <h2 id="fo-pumps-h" className="text-base font-semibold text-text">{t('products.pumps')}</h2>
        {catalog.pumps.length === 0 ? (
          <EmptyState title={t('products.noPumps.title')} body={t('products.noPumps.body')} />
        ) : (
          <ul className="space-y-3">
            {catalog.pumps.map(({ pump, nozzles }) => (
              <li key={pump.id} className="rounded-[14px] border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold text-text">{t('products.pump')} <span className="num">{pump.pump_number}</span>{pump.name ? ` · ${pump.name}` : ''}</p>
                  <AssetStatus status={pump.status} />
                </div>
                {nozzles.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t('products.noNozzles')}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border">
                    {nozzles.map((view) => <NozzleRow key={view.nozzle.id} view={view} showPump={false} />)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fo-tanks-h" className="space-y-3">
        <h2 id="fo-tanks-h" className="text-base font-semibold text-text">{t('products.tanks')}</h2>
        {catalog.tanks.length === 0 ? (
          <EmptyState title={t('products.noTanks.title')} body={t('products.noTanks.body')} />
        ) : (
          <ul className="space-y-3">
            {catalog.tanks.map(({ tank, product, nozzleCount }) => (
              <li key={tank.id} className="rounded-[14px] border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-base font-semibold text-text">{tank.name} <span className="num text-sm font-normal text-muted">({tank.code})</span></p>
                  <AssetStatus status={tank.status} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">{t('products.tankProduct')}</dt>
                    <dd className="mt-0.5 text-text">{product?.name ?? t('products.unknownProduct')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('products.tankCapacity')}</dt>
                    <dd className="mt-0.5 text-text"><Quantity value={formatLitersNumberFromMl(tank.capacity_milliliters, locale)} unit={t('unit.liter')} /></dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('products.tankNozzles')}</dt>
                    <dd className="num mt-0.5 text-text">{nozzleCount}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
        <InlineNote>{t('products.tankLevelNote')}</InlineNote>
      </section>
    </>
  );
}

export function ProductsScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('products.title')} subtitle={t('products.subtitle')} />
      <ScreenBody>
        <StationGate>{(station) => <Content station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
