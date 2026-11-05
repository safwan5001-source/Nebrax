'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, ChevronDown, Equal, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { formatMinorRiyal } from '@/lib/money';
import { CashSummarySection } from './cash-summary-section';
import { useStationOps } from './context';
import { useShiftDetail, useStationAssets, useStationPolicy, type ShiftDetailResult, type StationAssetsResult } from './data';
import { pendingReadings } from './entry';
import { elapsedBetween, formatLitersFixedFromMl, formatStampInZone } from './format';
import { PageMasthead, ScreenBody } from './masthead';
import { OPS_BASE } from './nav';
import { deriveNextStep } from './next-step';
import { NextStepCard } from './next-step-card';
import { buildShiftReadings, deriveProgress, type ProgressStep, type ShiftReadingsView } from './readings';
import type { ShiftDetail, Station } from './schemas';
import { ProgressSection, ProgressSummary } from './shift-progress';
import { ReadingsSection, TanksSection } from './shift-readings-section';
import { FinancialSummary, ShiftStatusBadge } from './shift-card';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from './state-views';

/**
 * UI-1 — شاشة «تفاصيل الوردية»: قراءة فقط من `GET /fuel-stations/shifts/{id}` (+ أصول المحطة لأسماء الفوهات).
 * قرار المنتج (2026-11-05): الموظف يبقى داخل التطبيق — لا رابط إلى ERP/إدارة المحطات. الترتيب: ملخص + التقدم ← «الخطوة التالية» ←
 * اللترات ← قراءات الفوهات (الأهم)، وما سواها (مراحل/خزانات/نقد) في أقسام مطوية. لا زر يسجّل أو يفتح أو يغلق أو يعتمد؛ الخطوة
 * القادمة نص بشارة «قريباً». اللترات هنا من فرق العدادات
 * ولا تُقدَّم كمبيعات أو تحصيل أو مخزون. الوردية المفتوحة بلا إجمالي مخزَّن (الخادم يحسبه عند الإغلاق) فيُحسب هنا من القراءات
 * المكتملة ويُوسَم جزئياً.
 */

const STALE_AFTER_MS = 5 * 60_000;
const AUTO_REFRESH_AFTER_MS = 60_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** يعيد الجلب عند عودة التبويب/الاتصال إن مضت دقيقة على آخر نجاح — لا استطلاع دوري صامت. */
function useRefreshOnReturn(enabled: boolean, fetchedAt: number | null, reload: () => void) {
  useEffect(() => {
    if (!enabled || fetchedAt === null) return undefined;
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - fetchedAt > AUTO_REFRESH_AFTER_MS) reload();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [enabled, fetchedAt, reload]);
}

function NotFoundPanel() {
  const t = useTranslations('stationOps');
  return (
    <div className="space-y-3">
      <EmptyState title={t('shiftDetail.notFound.title')} body={t('shiftDetail.notFound.body')} />
      <Link href={`${OPS_BASE}/shifts`} className="flex min-h-12 items-center justify-center rounded-lg border border-[color:var(--fo-control)] bg-surface px-4 text-base font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {t('shiftDetail.notFound.back')}
      </Link>
    </div>
  );
}

function SummaryCard({ detail, station, progress, fetchedAt, now, stale, refreshing, failed, onRefresh }: {
  detail: ShiftDetail;
  progress: ProgressStep[] | null;
  station: Station;
  fetchedAt: number | null;
  now: number;
  stale: boolean;
  refreshing: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { viewer } = useStationOps();
  const zone = station.timezone;
  const isOpen = detail.status === 'open';
  const running = isOpen ? elapsedBetween(detail.opened_at, now) : null;
  const total = !isOpen ? elapsedBetween(detail.opened_at, detail.closed_at) : null;
  const assigned = detail.staff_assignments;
  const updated = fetchedAt === null ? '—' : formatStampInZone(new Date(fetchedAt).toISOString(), locale, zone);

  return (
    <section aria-labelledby="fo-detail-h" className="relative z-10 -mt-5">
      <div className="rounded-[17px] border border-border bg-surface p-4 [box-shadow:var(--fo-shadow)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="fo-detail-h" className="num text-[19px] font-bold leading-7 text-text">{detail.number}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {t('shiftDetail.openedAtLabel')} <span className="tabular-nums">{formatStampInZone(detail.opened_at, locale, zone)}</span>
            </p>
          </div>
          <ShiftStatusBadge status={detail.status} />
        </div>

        <dl className="mt-3 space-y-1 text-xs text-muted">
          {detail.closed_at ? <div className="flex gap-1.5"><dt>{t('shift.closedAt')}:</dt><dd className="tabular-nums">{formatStampInZone(detail.closed_at, locale, zone)}</dd></div> : null}
          {detail.approved_at ? <div className="flex gap-1.5"><dt>{t('shift.approvedAt')}:</dt><dd className="tabular-nums">{formatStampInZone(detail.approved_at, locale, zone)}</dd></div> : null}
        </dl>

        <ul className="mt-2 space-y-1 text-sm text-text">
          {running ? <li className="tabular-nums">{t('shiftDetail.durationRunning', { hours: String(running.hours), minutes: String(running.minutes) })}</li> : null}
          {total ? <li className="tabular-nums">{t('shiftDetail.duration', { hours: String(total.hours), minutes: String(total.minutes) })}</li> : null}
          <li>
            {assigned === undefined ? t('shiftDetail.staffUnknown') : t('shiftDetail.staff', { count: String(assigned.length) })}
            {assigned?.some((member) => member.user_id === viewer.id) ? <span className="ms-2 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{t('shiftDetail.staffYou')}</span> : null}
          </li>
        </ul>

        {progress ? <div className="mt-3 border-t border-border pt-3"><ProgressSummary steps={progress} /></div> : null}
        {!zone ? <p className="mt-2 text-xs leading-5 text-warning">{t('shiftDetail.zoneDevice')}</p> : null}

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <p role="status" className={`min-w-0 text-xs leading-5 ${stale || failed ? 'text-warning' : 'text-muted'}`}>
            {failed
              ? t('shiftDetail.freshness.failed', { time: updated })
              : stale
                ? t('shiftDetail.freshness.stale', { time: updated })
                : <span className="tabular-nums">{t('shiftDetail.freshness.updatedAt', { time: updated })}</span>}
          </p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[color:var(--fo-control)] bg-surface px-3 text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.7} />
            {refreshing ? t('shiftDetail.freshness.refreshing') : t('shiftDetail.freshness.refresh')}
          </button>
        </div>
      </div>
    </section>
  );
}

function LitersCard({ detail, view }: { detail: ShiftDetail; view: ReturnType<typeof buildShiftReadings> }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { summary } = view;
  const isOpen = detail.status === 'open';
  const fmt = (ml: number) => formatLitersFixedFromMl(ml, locale);
  const caption = isOpen ? t('shiftDetail.liters.captionOpen') : t('shiftDetail.liters.captionClosed');

  // مفتوحة: لا إجمالي مخزَّن ⇒ نعرض المحسوب من القراءات المكتملة فقط، و«—» (لا 0) إن لم تكتمل أي فوهة.
  const value = isOpen ? (summary.recordedComplete > 0 ? fmt(summary.computedMl) : null) : fmt(detail.operational_meter_milliliters);
  const pending = isOpen && summary.expected !== null ? Math.max(0, summary.expected - summary.complete - summary.invalidExpected) : null;
  const cells = isOpen
    ? [
        { label: t('shiftDetail.liters.cellComplete'), value: summary.expected === null ? String(summary.complete) : `${summary.complete}/${summary.expected}` },
        { label: t('shiftDetail.liters.cellPending'), value: pending === null ? '—' : String(pending) },
      ]
    : [
        { label: t('shiftDetail.liters.cellComplete'), value: String(summary.complete) },
        { label: t('shiftDetail.liters.cellInvalid'), value: String(summary.invalid) },
      ];

  return (
    <section aria-label={caption} className="space-y-2.5">
      <FinancialSummary
        caption={caption}
        value={value}
        unit={t('unit.liter')}
        cells={cells}
      />
      {isOpen && summary.recordedComplete === 0 ? <InlineNote>{t('shiftDetail.liters.noneYet')}</InlineNote> : null}
      {summary.partial && summary.recordedComplete > 0 && summary.expected !== null ? (
        <InlineNote tone="warning">{t('shiftDetail.liters.partial', { complete: String(summary.complete), expected: String(summary.expected) })}</InlineNote>
      ) : null}
      {summary.invalid > 0 ? <InlineNote tone="warning">{t('shiftDetail.liters.invalid', { count: String(summary.invalid) })}</InlineNote> : null}
      {summary.mismatch && summary.serverMl !== null ? (
        <p role="alert" className="flex items-start gap-2 rounded-[14px] border border-border bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">
          <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>{t('shiftDetail.liters.mismatch', { server: fmt(summary.serverMl), computed: fmt(summary.computedMl) })}</span>
        </p>
      ) : null}
      <p className="flex items-start gap-2 rounded-[14px] border border-dashed border-border p-3 text-xs leading-5 text-muted">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
        <span>{t('shiftDetail.liters.meterNote')}</span>
      </p>
    </section>
  );
}

function CashSection({ detail }: { detail: ShiftDetail }) {
  const t = useTranslations('stationOps');
  const variance = detail.cash_variance_minor;
  const direction = variance === null ? null : variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage';
  const DirectionIcon = direction === 'overage' ? ArrowUpRight : direction === 'shortage' ? ArrowDownRight : Equal;
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : formatMinorRiyal(minor));
  const review = detail.cash_variance?.status;
  const reviewKnown = review === 'pending_review' || review === 'reviewed' || review === 'not_required';

  const rows: Array<{ label: string; value: string | null; emphasis?: boolean }> = [
    { label: t('shiftDetail.cash.openingFloat'), value: money(detail.opening_float_minor) },
    { label: t('shiftDetail.cash.counted'), value: money(detail.counted_cash_minor) },
    { label: t('shiftDetail.cash.expected'), value: money(detail.expected_operational_cash_minor) },
  ];

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-sm text-muted">{row.label}</dt>
            <dd className="num text-base font-semibold text-text">{row.value ?? <span className="text-sm font-normal text-muted">{t('shiftDetail.cash.notCounted')}</span>}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-sm text-muted">{t('shiftDetail.cash.variance')}</dt>
          <dd className="text-base font-bold text-text">
            {variance === null || direction === null ? (
              <span className="text-sm font-normal text-muted">{t('shiftDetail.cash.notCounted')}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <DirectionIcon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                <span className="num">{formatMinorRiyal(Math.abs(variance))}</span>
                <span className="text-sm font-semibold">{t(`shiftDetail.cash.direction.${direction}`)}</span>
              </span>
            )}
          </dd>
        </div>
        {review && reviewKnown ? (
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-sm text-muted">{t('shiftDetail.cash.review.label')}</dt>
            <dd className="text-sm font-medium text-text">{t(`shiftDetail.cash.review.${review}`)}</dd>
          </div>
        ) : null}
      </dl>
      <InlineNote>{t('shiftDetail.cash.note')}</InlineNote>
    </div>
  );
}

/** قسم مطوي (افتراضياً مغلق): التفاصيل الثانوية لا تزاحم قراءات الفوهات. هدف اللمس ≥ 56px. */
function MoreSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[14px] border border-border bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-base font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" strokeWidth={1.8} />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

function Loaded({ detail, query, assets, station }: { detail: ShiftDetail; query: ShiftDetailResult; assets: StationAssetsResult; station: Station }) {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const now = useNow(30_000);
  const fetchedAt = query.retained?.fetchedAt ?? null;
  const live = query.state.status === 'success';
  const refreshing = query.state.status === 'loading';
  const failed = query.state.status === 'error';
  const stale = live && fetchedAt !== null && now - fetchedAt > STALE_AFTER_MS;
  useRefreshOnReturn(live, fetchedAt, query.reload);

  const { policy } = useStationPolicy(station);
  const view: ShiftReadingsView | null = assets.catalog ? buildShiftReadings(detail, assets.catalog) : null;
  const extra = assets.catalog ? pendingReadings(detail, assets.catalog, policy) : null;
  const steps = view ? deriveProgress(detail, view.summary, extra) : null;
  const next = view ? deriveNextStep(detail, view.summary, can, extra) : null;

  return (
    <div className="space-y-5">
      <SummaryCard detail={detail} station={station} progress={steps} fetchedAt={fetchedAt} now={now} stale={stale} refreshing={refreshing} failed={failed} onRefresh={query.reload} />
      {next ? <NextStepCard step={next} /> : null}

      {assets.state.status === 'loading' ? <LoadingBlock rows={2} /> : null}
      {view ? <LitersCard detail={detail} view={view} /> : null}
      {detail.cash_summary ? <CashSummarySection summary={detail.cash_summary} /> : null}
      {view ? (
        <ReadingsSection view={view} shiftOpen={detail.status === 'open'} timeZone={station.timezone} />
      ) : assets.state.status === 'error' ? (
        <section aria-labelledby="fo-readings-h" className="space-y-3">
          <h2 id="fo-readings-h" className="text-base font-semibold text-text">{t('shiftDetail.readings.title')}</h2>
          <ErrorState error={assets.state.error} onRetry={assets.reload} />
          <InlineNote tone="warning">{t('shiftDetail.readings.assetsFailed')}</InlineNote>
        </section>
      ) : null}

      <div className="space-y-3">
        {steps ? <MoreSection title={t('shiftDetail.progress.title')}><ProgressSection steps={steps} timeZone={station.timezone} /></MoreSection> : null}
        <MoreSection title={t('shiftDetail.tanks.title')}><TanksSection detail={detail} catalog={assets.catalog} timeZone={station.timezone} /></MoreSection>
        {detail.cash_summary ? null : <MoreSection title={t('shiftDetail.cash.title')}><CashSection detail={detail} /></MoreSection>}
      </div>
    </div>
  );
}

function Content({ station, shiftId }: { station: Station; shiftId: string }) {
  const t = useTranslations('stationOps');
  const query = useShiftDetail(station, shiftId);
  const assets = useStationAssets(station);
  const wrap = (node: React.ReactNode) => <div className="pt-5">{node}</div>;

  if (!query.allowed) return wrap(<EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} />);

  const { state, retained } = query;
  if (state.status === 'success') return <Loaded detail={state.data} query={query} assets={assets} station={station} />;
  if (state.status === 'error' && (state.error.kind === 'not_found')) return wrap(<NotFoundPanel />);
  // تحديث جارٍ أو فشل عابر (انقطاع/خادم/شكل غير مفهوم): نُبقي آخر بيانات هذا المفتاح نفسه مع تنبيه صريح، ولا نخفيها خلف خطأ.
  const transient = state.status === 'loading' || (state.status === 'error' && ['offline', 'server', 'invalid_shape'].includes(state.error.kind));
  if (transient && retained) return <Loaded detail={retained.data} query={query} assets={assets} station={station} />;
  if (state.status === 'loading') return wrap(<LoadingBlock rows={3} />);
  return wrap(<ErrorState error={state.error} onRetry={query.reload} />);
}

export function ShiftDetailScreen({ shiftId }: { shiftId: string }) {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('shiftDetail.title')} subtitle={t('shiftDetail.subtitle')} raised backHref={`${OPS_BASE}/shifts`} backLabel={t('shiftDetail.back')} />
      <ScreenBody flush>
        <StationGate gateClassName="pt-5">{(station) => <Content station={station} shiftId={shiftId} />}</StationGate>
      </ScreenBody>
    </>
  );
}
