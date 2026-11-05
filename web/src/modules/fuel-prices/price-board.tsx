'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Building2, Fuel, History, Lightbulb, Lock, RefreshCw, Store } from 'lucide-react';
import { formatDate } from '@/lib/formatting';
import { formatMinorRiyal } from '@/lib/money';
import { useCan, useCurrentUser } from '@/lib/use-can';
import { listEffective, listNozzles, listProducts, listStations, listSuggestions, PricesError } from './client';
import { scopeKey, type EffectiveRow, type FuelProduct, type PriceScope, type Station, type SuggestionRow } from './contract';
import { HistorySheet } from './history-sheet';
import { PriceSheet } from './price-sheet';
import { describeRow, describeSuggestion } from './row-view';
import { useLoader, type LoaderState } from './use-loader';

/** فاصل التحديث الصامت للوحة (ms). */
export const BOARD_REFRESH_MS = 60_000;
const READ = 'fuel.sale.view';
const MANAGE = 'fuel.sale.price.manage';

function ErrorPanel({ error, onRetry }: { error: PricesError; onRetry: () => void }) {
  const t = useTranslations('fuelPrices');
  const key = error.kind === 'forbidden' ? 'forbidden' : error.kind === 'offline' || error.kind === 'timeout' ? 'offline' : error.kind === 'invalid_shape' ? 'invalid' : 'error';
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-5 py-10 text-center">
      {key === 'forbidden' ? <Lock aria-hidden="true" className="h-7 w-7 text-muted" strokeWidth={1.6} /> : <AlertTriangle aria-hidden="true" className="h-7 w-7 text-muted" strokeWidth={1.6} />}
      <p className="text-base font-semibold text-text">{t(`state.${key}.title`)}</p>
      <p className="max-w-sm text-sm leading-6 text-muted">{t(`state.${key}.body`)}</p>
      {key !== 'forbidden' ? (
        <button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
          {t('retry')}
        </button>
      ) : null}
    </div>
  );
}

function Skeletons() {
  const t = useTranslations('fuelPrices');
  return (
    <div role="status" aria-label={t('loading')} className="space-y-3">
      {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-border/60" />)}
    </div>
  );
}

interface Target { kind: 'edit' | 'suggestion' | 'history'; product: FuelProduct }

export function PriceBoard() {
  const t = useTranslations('fuelPrices');
  const locale = useLocale();
  const user = useCurrentUser();
  const { can, hydrated } = useCan();
  const canRead = can(READ);
  const canManage = can(MANAGE);
  // سعر المؤسسة يؤثر على كل المحطات: لا يملكه المقيَّد بفرع/مخزن (الخادم يرفض 403 أيضاً؛ هذا إخفاء عرض فقط).
  const restricted = (user?.branch_ids?.length ?? 0) > 0 || (user?.warehouse_ids?.length ?? 0) > 0;
  // هوية القراءات تشمل **نطاق الفرع/المخزن**: تغيّره (تحديث `/me` من تبويب آخر) يُبطل المحطات والفوهات والأسعار فلا تبقى بيانات نطاق سابق.
  const scopeIds = (ids: string[] | undefined) => (ids === undefined ? 'u' : [...ids].sort().join(','));
  const userKey = `${user?.tenant_id ?? '-'}|${user?.id ?? '-'}|b:${scopeIds(user?.branch_ids)}|w:${scopeIds(user?.warehouse_ids)}`;

  const stations = useLoader(hydrated && canRead ? `${userKey}|stations` : null, (signal) => listStations(signal).then((r) => r.data));
  const [scopeKind, setScopeKind] = useState<'station' | 'tenant'>('station');
  const [pickedStation, setPickedStation] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const stationList = stations.state.status === 'success' ? stations.state.data : [];
  const station: Station | undefined = stationList.find((s) => s.id === pickedStation) ?? stationList[0];
  const scope: PriceScope | null = scopeKind === 'tenant' ? { kind: 'tenant' } : station ? { kind: 'station', stationId: station.id } : null;
  const sKey = scope ? scopeKey(scope) : null;
  const writable = canManage && (scope?.kind === 'station' || !restricted);

  const products = useLoader(scope ? `${userKey}|products` : null, (signal) => listProducts(signal).then((r) => r.data));
  const nozzles = useLoader(scope?.kind === 'station' ? `${userKey}|nozzles` : null, (signal) => listNozzles(signal).then((r) => r.data));
  const effective = useLoader(scope && sKey ? `${userKey}|effective|${sKey}` : null, (signal) => (scope ? listEffective(scope, signal).then((r) => r.data) : Promise.resolve([])));
  const suggestions = useLoader(scope && writable && sKey ? `${userKey}|suggestions|${sKey}` : null, (signal) => (scope ? listSuggestions(scope, signal).then((r) => r.data) : Promise.resolve([])));

  const reloadBoard = () => { effective.reload(); suggestions.reload(); };
  const retryAll = () => { stations.reload(); products.reload(); nozzles.reload(); effective.reload(); suggestions.reload(); };

  // سعر مجدول يبدأ سريانه (أو ينتهي سعر) بمرور الوقت: تحديث صامت عند العودة للتبويب وكل دقيقة، ومتوقف أثناء فتح ورقة.
  const { refresh: refreshEffective } = effective;
  const { refresh: refreshSuggestions } = suggestions;
  const sheetOpen = target !== null;
  useEffect(() => {
    if (sheetOpen || sKey === null) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') { refreshEffective(); refreshSuggestions(); } };
    const timer = window.setInterval(tick, BOARD_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [sheetOpen, sKey, refreshEffective, refreshSuggestions]);

  const rows = useMemo(() => new Map<string, EffectiveRow>(effective.state.status === 'success' ? effective.state.data.map((r) => [r.fuel_product_id, r]) : []), [effective.state]);
  const suggestionRows = useMemo(() => new Map<string, SuggestionRow>(suggestions.state.status === 'success' ? suggestions.state.data.map((r) => [r.fuel_product_id, r]) : []), [suggestions.state]);

  if (!hydrated) return <Skeletons />;
  if (!canRead) return <ErrorPanel error={new PricesError('forbidden')} onRetry={() => {}} />;

  const scopeLabel = scope?.kind === 'tenant' ? t('scope.organizationLabel') : station ? t('scope.stationLabel', { name: station.name }) : '';

  // قائمة المنتجات: في المحطة ما له فوهة نشطة فيها فقط؛ في المؤسسة كل المنتجات النشطة.
  let shown: FuelProduct[] = [];
  let hiddenCount = 0;
  if (products.state.status === 'success') {
    const active = products.state.data.filter((p) => p.is_active && rows.has(p.id));
    if (scope?.kind === 'station' && nozzles.state.status === 'success') {
      const linked = new Set(nozzles.state.data.filter((n) => n.fuel_station_id === scope.stationId && n.status === 'active').map((n) => n.fuel_product_id));
      shown = active.filter((p) => linked.has(p.id));
      hiddenCount = active.length - shown.length;
    } else if (scope?.kind === 'tenant') shown = active;
  }

  const states: Array<LoaderState<unknown>> = [stations.state, products.state, effective.state, ...(scope?.kind === 'station' ? [nozzles.state] : [])];
  const failed = states.find((s) => s.status === 'error') as { status: 'error'; error: PricesError } | undefined;
  const loading = states.some((s) => s.status === 'loading');

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 text-sm leading-6 text-muted">{t('subtitle')}</p>
      </header>

      <section aria-label={t('scope.label')} className="space-y-3">
        <div role="radiogroup" aria-label={t('scope.label')} className="grid grid-cols-2 gap-1 rounded-2xl bg-primary-soft p-1">
          {(['station', 'tenant'] as const).map((kind) => {
            const Icon = kind === 'station' ? Store : Building2;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={scopeKind === kind}
                onClick={() => setScopeKind(kind)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${scopeKind === kind ? 'bg-surface text-text shadow-sm' : 'text-muted'}`}
              >
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
                {t(`scope.${kind}`)}
              </button>
            );
          })}
        </div>

        {scopeKind === 'station' && stationList.length > 0 ? (
          <div>
            <label htmlFor="fp-station" className="sr-only">{t('scope.pickStation')}</label>
            <select
              id="fp-station"
              value={station?.id ?? ''}
              onChange={(event) => setPickedStation(event.target.value)}
              className="block min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {stationList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ) : null}

        {scopeKind === 'tenant' ? (
          <p className="rounded-xl bg-primary-soft px-4 py-3 text-xs leading-5 text-muted">
            {restricted || !canManage ? t('scope.organizationReadOnly') : t('scope.organizationNote')}
          </p>
        ) : null}
      </section>

      {failed ? (
        <ErrorPanel error={failed.error} onRetry={retryAll} />
      ) : loading || !scope ? (
        stations.state.status === 'success' && stationList.length === 0 && scopeKind === 'station' ? (
          <div role="status" className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted">{t('state.noStations')}</div>
        ) : (
          <Skeletons />
        )
      ) : shown.length === 0 ? (
        <div role="status" className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
          <p className="text-base font-semibold text-text">{t('state.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">{t(scope.kind === 'station' ? 'state.empty.stationBody' : 'state.empty.organizationBody')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((product) => {
            const row = rows.get(product.id);
            const view = describeRow(row);
            const sug = describeSuggestion(suggestionRows.get(product.id));
            return (
              <li key={product.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Fuel aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={1.7} /></span>
                    <h2 className="truncate text-base font-semibold text-text">{product.name}</h2>
                  </div>
                  {view.kind === 'known' ? (
                    <span className="shrink-0 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{view.scope === 'station' ? t('card.sourceStation') : t('card.sourceTenant')}</span>
                  ) : null}
                </div>

                <div className="mt-3">
                  {view.kind === 'known' ? (
                    <>
                      <p className="text-3xl font-semibold leading-none text-text">
                        <span className="num">{formatMinorRiyal(view.minor)}</span>
                        <span className="ms-1.5 text-sm font-normal text-muted">{t('card.perLiter')}</span>
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {view.taxMode === 'tax_inclusive' ? t('card.taxInclusive') : view.taxMode === 'tax_exclusive' ? t('card.taxExclusive') : <span className="text-warning">{t('card.taxUnset')}</span>}
                        {view.from ? <> · {t('card.since', { date: formatDate(view.from, locale, { timeZone: station?.timezone ?? undefined }) })}</> : null}
                        {view.until ? <> · {t('card.until', { date: formatDate(view.until, locale, { timeZone: station?.timezone ?? undefined }) })}</> : null}
                      </p>
                      {!view.sellable
                        ? view.blockers.filter((b) => ['tax_mode_unset', 'unit_mapping_invalid', 'product_inactive', 'price_not_configured'].includes(b)).map((b) => (
                            <p key={b} className="mt-1 text-xs text-warning">{t(`card.blocked.${b}`)}</p>
                          ))
                        : null}
                    </>
                  ) : view.kind === 'not_configured' ? (
                    <>
                      <p className="text-lg font-semibold text-warning">{t('card.notSet')}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{t('card.notSetHint')}</p>
                    </>
                  ) : view.kind === 'product_inactive' ? (
                    <p className="text-sm text-warning">{t('card.productInactive')}</p>
                  ) : (
                    <p className="text-sm text-warning">{t('card.invalid')}</p>
                  )}
                </div>

                {writable && sug.kind === 'available' && !sug.matchesCurrent && view.kind !== 'invalid' ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-primary-soft px-3 py-2.5">
                    <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-text">
                      <Lightbulb aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                      <span>{t('suggestion.available', { price: formatMinorRiyal(sug.minor) })}</span>
                    </p>
                    <button type="button" onClick={() => setTarget({ kind: 'suggestion', product })} className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {t('suggestion.review')}
                    </button>
                  </div>
                ) : writable && sug.kind === 'blocked' && view.kind === 'not_configured' ? (
                  <p className="mt-3 rounded-xl bg-primary-soft px-3 py-2.5 text-xs leading-5 text-muted">
                    <span className="font-medium text-text">{t('suggestion.requiresLiter')}</span>
                    {' — '}
                    {sug.blockers.map((b) => t(`suggestion.blocked.${b}`)).join('، ')}
                  </p>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {writable ? (
                    <button type="button" data-primary-action={view.kind === 'not_configured' ? '' : undefined} onClick={() => setTarget({ kind: 'edit', product })} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                      {view.kind === 'known' && view.scope === (scope.kind === 'station' ? 'station' : 'tenant') ? t('card.edit') : t('card.set')}
                    </button>
                  ) : (
                    <p className="flex min-h-12 items-center gap-1.5 text-xs text-muted"><Lock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />{t('card.readOnly')}</p>
                  )}
                  <button type="button" onClick={() => setTarget({ kind: 'history', product })} className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <History aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
                    {t('card.history')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && !failed && !loading ? <p className="text-center text-xs text-muted">{t('state.hiddenProducts', { count: String(hiddenCount) })}</p> : null}

      {scope && target && target.kind !== 'history' ? (
        <PriceSheet
          open
          onOpenChange={(open) => { if (!open) setTarget(null); }}
          mode={target.kind === 'suggestion' ? 'suggestion' : 'manual'}
          scope={scope}
          scopeLabel={scopeLabel}
          timeZone={station?.timezone ?? null}
          productName={target.product.name}
          fuelProductId={target.product.id}
          row={rows.get(target.product.id)}
          suggestion={suggestionRows.get(target.product.id)}
          onChanged={() => reloadBoard()}
        />
      ) : null}
      {scope && target && target.kind === 'history' ? (
        <HistorySheet
          open
          onOpenChange={(open) => { if (!open) setTarget(null); }}
          scope={scope}
          scopeLabel={scopeLabel}
          timeZone={station?.timezone ?? null}
          productName={target.product.name}
          fuelProductId={target.product.id}
        />
      ) : null}
    </div>
  );
}
