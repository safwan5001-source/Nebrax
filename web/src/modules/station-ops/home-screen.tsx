'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { FuelIcon, resolveFuelIcon } from '@/lib/fuel-icons';
import type { StationCatalog } from './catalog';
import { useStationOps } from './context';
import { useCurrentShift, useShiftDetail, useStationAssets, useStationPolicy, useStationPrices } from './data';
import { pendingReadings } from './entry';
import { formatLitersFixedFromMl } from './format';
import { HomeMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import { deriveNextStep } from './next-step';
import { NextStepCard } from './next-step-card';
import { PriceLabel } from './price-label';
import { buildShiftReadings, deriveProgress } from './readings';
import type { Shift, Station } from './schemas';
import { CurrentShiftBanner, FinancialSummary } from './shift-card';
import { ProgressSummary } from './shift-progress';
import { StationGate } from './station-gate';
import { ErrorState, InlineNote, LoadingBlock } from './state-views';

/**
 * الرئيسية — قرار المنتج 2026-11-05 (APP-ONLY / SIMPLE UX): تجيب ثلاثة أسئلة فقط، بلا خروج من التطبيق:
 *   أين أنا؟ (الرأس: المحطة)  ·  ما حالة ورديتي؟ (بطاقة الوردية + التقدم + اللترات)  ·  ما الخطوة التالية؟ («الخطوة التالية»).
 * زر أساسي **واحد** (برتقالي) ينقل إلى تفاصيل الوردية داخل التطبيق. لا رابط إلى ERP ولا إلى إدارة المحطات؛ ما لم يُنفَّذ بعد
 * (تسجيل القراءات/التسليم/الاعتماد) يظهر نصاً بشارة «قريباً»، لا زراً.
 */

function PrimaryAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      data-primary-action=""
      className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
      <ArrowLeft aria-hidden="true" className="h-5 w-5 rtl:rotate-0 ltr:rotate-180" strokeWidth={2} />
    </Link>
  );
}

function summaryCells(t: ReturnType<typeof useTranslations>, catalog: StationCatalog | null) {
  const products = catalog ? String(catalog.products.length) : '—';
  const pumps = catalog ? String(catalog.pumps.filter(({ nozzles }) => nozzles.some((view) => view.blockedBy === null)).length) : '—';
  return [
    { label: t('home.cellProducts'), value: products },
    { label: t('home.cellPumps'), value: pumps },
  ];
}

/** وردية مفتوحة: بطاقة (حالة + تقدم) ← لترات العدادات ← الخطوة التالية ← الزر الأساسي. */
function OpenShift({ station, shift, catalog, multiple }: { station: Station; shift: Shift; catalog: StationCatalog | null; multiple: boolean }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { can } = useStationOps();
  const detail = useShiftDetail(station, shift.id);
  const { policy } = useStationPolicy(station);
  const loaded = detail.state.status === 'success' && catalog !== null ? detail.state.data : null;
  const view = loaded && catalog ? buildShiftReadings(loaded, catalog) : null;
  const extra = loaded && catalog ? pendingReadings(loaded, catalog, policy) : null;
  const steps = loaded && view ? deriveProgress(loaded, view.summary, extra) : null;
  const next = loaded && view ? deriveNextStep(loaded, view.summary, can, extra) : null;
  // زر أساسي واحد: الخطوة التالية الفعلية لمن يملك صلاحيتها (داخل التطبيق)، وإلا عرض الوردية.
  const action = next?.mine && next.href ? { href: next.href, label: t(`next.kind.${next.kind}`) } : { href: `${OPS_BASE}/shifts/${encodeURIComponent(shift.id)}`, label: t('home.ctaCurrent') };

  let value: string | null = null;
  let note: string | undefined;
  if (view) {
    const { summary } = view;
    if (summary.recordedComplete > 0) {
      value = formatLitersFixedFromMl(summary.computedMl, locale);
      if (summary.partial && summary.expected !== null) note = t('shiftDetail.liters.partial', { complete: String(summary.complete), expected: String(summary.expected) });
    } else {
      note = t('shiftDetail.liters.noneYet');
    }
  } else {
    note = detail.state.status === 'error' ? t('shiftDetail.home.liveUnavailable') : t('loading');
  }

  return (
    <>
      <CurrentShiftBanner shift={shift} timeZone={station.timezone}>
        {steps ? <div className="mt-3 border-t border-border pt-3"><ProgressSummary steps={steps} /></div> : null}
        {multiple ? <div className="mt-3"><InlineNote tone="warning">{t('shift.multipleOpen')}</InlineNote></div> : null}
      </CurrentShiftBanner>
      <div className="space-y-3 pt-1">
        {/* الخطوة التالية وزرّها الأساسي أولاً (داخل الشاشة الأولى على الجوال)، ثم ملخص اللترات. */}
        {next ? <NextStepCard step={next} showAction={false} /> : null}
        <PrimaryAction href={action.href} label={action.label} />
        <FinancialSummary caption={t('shiftDetail.home.litersOpen')} value={value} unit={t('unit.liter')} note={note} cells={summaryCells(t, catalog)} />
      </div>
    </>
  );
}

function ShiftArea({ station, catalog }: { station: Station; catalog: StationCatalog | null }) {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const current = useCurrentShift(station);

  if (!current.allowed) {
    return (
      <>
        <CurrentShiftBanner shift={null} timeZone={station.timezone}>
          <div className="mt-2">
            <p className="text-base font-semibold text-text">{t('shift.noPermission.title')}</p>
            <p className="mt-0.5 text-sm leading-6 text-muted">{t('shift.noPermission.body')}</p>
          </div>
        </CurrentShiftBanner>
      </>
    );
  }
  if (current.state.status === 'loading') {
    return (
      <>
        <CurrentShiftBanner shift={null} timeZone={station.timezone}>
          <div role="status" aria-busy="true" className="mt-3 space-y-2"><span className="sr-only">{t('loading')}</span><div className="h-6 w-32 animate-pulse rounded bg-border/60" /><div className="h-4 w-48 animate-pulse rounded bg-border/60" /></div>
        </CurrentShiftBanner>
      </>
    );
  }
  if (current.state.status === 'error') {
    return (
      <CurrentShiftBanner shift={null} timeZone={station.timezone}>
        <div className="mt-3"><ErrorState error={current.state.error} onRetry={current.reload} /></div>
      </CurrentShiftBanner>
    );
  }
  const { shift, multiple } = current.state.data;
  if (shift) return <OpenShift key={shift.id} station={station} shift={shift} catalog={catalog} multiple={multiple} />;

  const next = deriveNextStep(null, null, can);
  return (
    <>
      <CurrentShiftBanner shift={null} timeZone={station.timezone}>
        <div className="mt-2">
          <p className="text-base font-semibold text-text">{t('shift.none.title')}</p>
          <p className="mt-0.5 text-sm leading-6 text-muted">{t('shift.none.body')}</p>
        </div>
      </CurrentShiftBanner>
      <div className="space-y-3 pt-1">
        {next ? <NextStepCard step={next} showAction={false} /> : null}
        {next?.href ? <PrimaryAction href={next.href} label={t(`next.kind.${next.kind}`)} /> : can('fuel.shift.view') ? <PrimaryAction href={`${OPS_BASE}/shifts`} label={t('home.ctaHistory')} /> : null}
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
              <li key={entry.product.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5">
                <FuelIcon id={resolveFuelIcon('product', entry.product)} size={48} plate="always" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-semibold text-text">{entry.product.name}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted">
                    {t('home.pumpsNozzles', { pumps: String(entry.pumpIds.length), nozzles: String(entry.nozzles.length) })}
                  </p>
                </div>
                <div className="w-full min-w-0 sm:w-auto"><PriceLabel allowed={prices.allowed} state={prices.state} productId={entry.product.id} timeZone={station.timezone} /></div>
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

function Body({ station }: { station: Station }) {
  const assets = useStationAssets(station);
  return (
    <div className="space-y-5">
      <ShiftArea station={station} catalog={assets.catalog} />
      <ProductsSection station={station} assets={assets} />
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
