'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/formatting';
import { classifyError, hasPermission } from '../access';
import { Field } from '../fields';
import { listStations, type StationOption } from '../settings-client';
import { ForbiddenState, GateClosedState } from '../states';
import { usePermissions } from '../use-permissions';
import { getInventoryReview } from './client';
import { isKnownBlocker, isKnownReason, litersOf, READINESS, type PoolSummary, type Readiness, type ReviewPage, type ReviewRow } from './logic';
import { INVENTORY_REVIEW_PERMISSION } from './routes';

type Phase = 'loading' | 'ready' | 'gate_closed' | 'forbidden' | 'error';

const TONE: Record<Readiness, 'positive' | 'warning' | 'negative'> = { ready: 'positive', needs_review: 'warning', blocked: 'negative' };

/**
 * TANKER-PR6A — مراجعة جاهزية الدمج المخزني لسندات تعبئة الصهاريج المعلّقة. **شاشة عرض فقط**: لا زر ترحيل ولا خصم ولا اعتماد ولا أي كتابة (قرار المالك: «لا خصم الآن»).
 * تعرض لكل سند حالة الجاهزية وموانعها وأسباب المراجعة، وملخصات المجمّعات (رصيد المخزن مقابل مجمّع التكلفة) ومتطلبات المطابقة. الخادم هو السلطة؛ تصنيف مجهول ⇒ «يحتاج مراجعة».
 */
export function InventoryReviewScreen() {
  const t = useTranslations('fuelTankers.inventory');
  const locale = useLocale();
  const permissions = usePermissions();
  const canView = hasPermission(permissions, INVENTORY_REVIEW_PERMISSION) && hasPermission(permissions, 'fuel_stations.view');

  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<ReviewPage | null>(null);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationId, setStationId] = useState('');
  const [readiness, setReadiness] = useState<Readiness | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setPhase('loading');
    try {
      const result = await getInventoryReview({ stationId, readiness, overdue: overdueOnly, page });
      if (mine !== sequence.current) return;
      setData(result);
      setPhase('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = classifyError(error, 'list');
      setPhase(problem === 'gate_closed' ? 'gate_closed' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [stationId, readiness, overdueOnly, page]);

  useEffect(() => { if (canView) void load(); }, [canView, load]);
  useEffect(() => { if (canView) listStations().then(setStations).catch(() => setStations([])); }, [canView]);

  if (permissions === null) return <LoadingState variant="cards" rows={3} />;
  if (!canView || phase === 'forbidden') return <ForbiddenState required={INVENTORY_REVIEW_PERMISSION} />;
  if (phase === 'gate_closed') return <GateClosedState />;
  if (phase === 'error') return <ErrorState message={t('loadFailed')} onRetry={() => void load()} />;
  if (phase === 'loading' && data === null) return <LoadingState variant="cards" rows={3} />;

  const summary = data?.summary;
  const reset = (apply: () => void) => { apply(); setPage(1); };

  return (
    <div className="space-y-4" data-inventory-review="">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
      <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-posting-disabled={data?.postingEnabled === false ? 'true' : 'false'}>
        {t('notEnabled')}
      </p>

      {summary ? (
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-5" data-inventory-summary="">
          {([['total', summary.total, 'neutral'], ['ready', summary.ready, 'positive'], ['needs_review', summary.needsReview, 'warning'], ['blocked', summary.blocked, 'negative'], ['overdue', summary.overdue, 'warning']] as const).map(([key, value, tone]) => (
            <div key={key} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted">{t(`summary.${key}`)}</dt>
              <dd className="num mt-1 text-xl font-semibold text-text"><Badge tone={tone}>{value}</Badge></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {data?.truncated ? <p role="note" className="text-sm text-muted">{t('truncated')}</p> : null}

      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-3">
          <Field id="inventory-review-station" label={t('filters.station')}>
            <Select value={stationId} onChange={(event) => reset(() => setStationId(event.target.value))}>
              <option value="">{t('filters.allStations')}</option>
              {stations.map((station) => <option key={station.id} value={station.id}>{station.name}{station.code ? ` (${station.code})` : ''}</option>)}
            </Select>
          </Field>
          <Field id="inventory-review-readiness" label={t('filters.readiness')}>
            <Select value={readiness} onChange={(event) => reset(() => setReadiness(event.target.value as Readiness | ''))}>
              <option value="">{t('filters.allReadiness')}</option>
              {READINESS.map((value) => <option key={value} value={value}>{t(`readiness.${value}`)}</option>)}
            </Select>
          </Field>
          <Field id="inventory-review-overdue" label={t('filters.overdue')}>
            <Select value={overdueOnly ? '1' : ''} onChange={(event) => reset(() => setOverdueOnly(event.target.value === '1'))}>
              <option value="">{t('filters.anyAge')}</option>
              <option value="1">{t('filters.overdueOnly')}</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {data !== null && data.rows.length === 0 ? (
        <p role="status" className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-2.5" aria-live="polite" data-inventory-rows="">
          {data?.rows.map((row) => <FillRow key={row.id} row={row} locale={locale} />)}
        </ul>
      )}

      {data !== null && data.lastPage > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" className="max-md:min-h-11" disabled={page <= 1 || phase === 'loading'} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t('previous')}</Button>
          <span className="num text-sm text-muted">{t('pageOf', { page: data.page, last: data.lastPage })}</span>
          <Button type="button" variant="outline" className="max-md:min-h-11" disabled={page >= data.lastPage || phase === 'loading'} onClick={() => setPage((p) => p + 1)}>{t('next')}</Button>
        </div>
      ) : null}

      {data !== null && data.pools.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t('pools.title')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">{t('pools.hint')}</p>
            <ul className="space-y-2" data-inventory-pools="">{data.pools.map((pool) => <PoolRow key={`${pool.warehouseId}|${pool.fuelProductId}`} pool={pool} />)}</ul>
            <details className="rounded-md border border-border px-3 py-2" data-reconciliation="">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('requirements.title')}</summary>
              <ul className="list-disc space-y-1 pb-2 ps-5 text-sm text-muted">
                {(data.requirements.length > 0 ? data.requirements : ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140']).map((code) => (
                  <li key={code}>{code === 'pool_quantity_equals_warehouse_stock' ? t('requirements.quantity') : code === 'pool_value_equals_fuel_share_of_ledger_1140' ? t('requirements.value') : t('requirements.other')}</li>
                ))}
              </ul>
              <p className="pb-2 text-xs text-muted">{t('requirements.ledgerNotChecked')}</p>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted">
        <Link href="/fuel-stations/tanker-settings" className="text-primary underline-offset-2 hover:underline">{t('settingsLink')}</Link>
      </p>
    </div>
  );
}

function FillRow({ row, locale }: { row: ReviewRow; locale: string }) {
  const t = useTranslations('fuelTankers.inventory');
  const item = row.readiness;
  return (
    <li className="space-y-2 rounded-md border border-border p-3" data-fill-row="" data-readiness={item.readiness}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text"><bdi className="num">{row.number}</bdi> <span className="font-normal text-muted">· {t('voucher')} <bdi className="num">{row.voucherNumber}</bdi></span></p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={TONE[item.readiness]} data-readiness-badge="">{t(`readiness.${item.readiness}`)}</Badge>
          {item.overdue ? <Badge tone="warning">{t('overdueBadge')}</Badge> : null}
        </div>
      </div>
      <p className="text-sm text-text">
        <span className="num">{row.quantityLiters || litersOf(row.quantityMilliliters)}</span> {t('liters')}
        {row.ownerName ? <> · {row.ownerName}</> : null}
        {row.tankerPlate ? <> · <bdi>{row.tankerPlate}</bdi></> : null}
      </p>
      <p className="text-xs text-muted">{t('recordedAt', { when: row.recordedAt ? formatDateTime(row.recordedAt, locale) : '—', hours: item.ageHours })}</p>
      {item.blockers.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('blockers')} data-blockers="">
          {item.blockers.map((code) => <li key={code}><Badge tone="negative" wrap>{isKnownBlocker(code) ? t(`blocker.${code}`) : t('blocker.unknown')}</Badge></li>)}
        </ul>
      ) : null}
      {item.reviewReasons.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('reasons')} data-reasons="">
          {item.reviewReasons.map((code) => <li key={code}><Badge tone="warning" wrap>{isKnownReason(code) ? t(`reason.${code}`) : t('reason.unknown')}</Badge></li>)}
        </ul>
      ) : null}
      {item.availableMilliliters !== null ? (
        <p className="text-xs text-muted">{t('balanceLine', { available: litersOf(item.availableMilliliters), cumulative: litersOf(item.cumulativeMilliliters) })}</p>
      ) : null}
    </li>
  );
}

function PoolRow({ pool }: { pool: PoolSummary }) {
  const t = useTranslations('fuelTankers.inventory');
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm" data-pool-row="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text">{t('pools.stock')}: <span className="num">{litersOf(pool.stockMilliliters)}</span> {t('liters')}</span>
        {pool.quantityInSync === null ? <Badge tone="neutral">{t('pools.syncUnknown')}</Badge> : pool.quantityInSync ? <Badge tone="positive">{t('pools.inSync')}</Badge> : <Badge tone="negative">{t('pools.outOfSync')}</Badge>}
      </div>
      <p className="text-muted">{t('pools.costPool')}: <span className="num">{litersOf(pool.costPoolMilliliters)}</span> {t('liters')}</p>
      <p className="text-muted">{t('pools.pending', { count: pool.pendingCount, liters: litersOf(pool.pendingTotalMilliliters) })}</p>
      {pool.shortfallMilliliters !== null && pool.shortfallMilliliters > 0 ? <p className="text-negative">{t('pools.shortfall', { liters: litersOf(pool.shortfallMilliliters) })}</p> : null}
    </li>
  );
}
