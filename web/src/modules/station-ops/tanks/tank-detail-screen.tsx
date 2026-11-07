'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Badge } from '../admin/ui';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import type { Station } from '../schemas';
import { formatStampInZone } from '../format';
import { SecondaryButton, SectionCard } from '../write-ui';
import { useTankHistory, useTankLevels, useTanksAccess } from './data';
import { FlagBadge, FreshnessBadge, LevelSummary, Liters, TANKS_BASE, TypeText } from './parts';
import { RecordForm } from './record-form';
import type { HistoryRow, ReadingKind, TankLevel } from './schemas';

const FILTERS = ['all', 'physical', 'atg'] as const;

function HistoryItem({ row, timeZone }: { row: HistoryRow; timeZone: string | null | undefined }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const method = row.evidence?.method;
  const note = row.evidence?.note;
  return (
    <li className="space-y-1 py-3" data-history-row="">
      <div className="flex items-baseline justify-between gap-3">
        <strong className="num text-base text-text" dir="ltr"><Liters ml={row.quantity_milliliters} /></strong>
        <span className="num text-sm text-muted">{formatStampInZone(row.measured_at ?? row.created_at, locale, timeZone)}</span>
      </div>
      <p className="text-sm leading-6 text-muted">
        <TypeText type={row.reading_type} />
        {method && ['dipstick', 'gauge', 'atg_console', 'other'].includes(method) ? <> · {t(`tanks.method.${method}`)}</> : null}
        {row.recorder?.name ? <> · {t('tanks.history.by', { name: row.recorder.name })}</> : null}
      </p>
      {row.late_entry ? (
        <div className="space-y-1" data-late-entry="">
          <Badge tone="info">{t('tanks.history.late')}</Badge>
          {row.late_reason ? <p className="break-words text-sm leading-6 text-muted">{t('tanks.history.lateReason', { reason: row.late_reason })}</p> : null}
        </div>
      ) : null}
      {note ? <p className="break-words text-sm leading-6 text-text">{note}</p> : null}
      {row.flags && row.flags.length > 0 ? <div className="flex flex-wrap gap-1.5">{row.flags.map((flag) => <FlagBadge key={flag} flag={flag} />)}</div> : null}
    </li>
  );
}

function History({ station, tankId }: { station: Station; tankId: string }) {
  const t = useTranslations('stationOps');
  const [page, setPage] = useState(1);
  const [type, setType] = useState<ReadingKind | 'all'>('all');
  // يُعاد تركيبه (`key`) بعد كل حفظ ناجح فيُجلب أحدث سجل من الصفحة الأولى.
  const history = useTankHistory(station, tankId, page, type);
  const { state } = history;
  return (
    <SectionCard title={t('tanks.history.title')} id="tank-history-title">
      <div role="radiogroup" aria-label={t('tanks.history.filterLabel')} className="mb-3 grid grid-cols-3 gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={type === value}
            onClick={() => { setType(value); setPage(1); }}
            className={cn('min-h-12 rounded-lg border px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', type === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}
          >
            {value === 'all' ? t('tanks.history.filterAll') : t(`tanks.type.${value}`)}
          </button>
        ))}
      </div>
      {state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={history.reload} /> : null}
      {state.status === 'success' && state.data.rows.length === 0 ? <EmptyState title={t('tanks.history.empty')} /> : null}
      {state.status === 'success' && state.data.rows.length > 0 ? (
        <>
          <ul className="divide-y divide-border">{state.data.rows.map((row) => <HistoryItem key={row.id} row={row} timeZone={station.timezone} />)}</ul>
          <nav aria-label={t('tanks.history.pagination')} className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SecondaryButton disabled={state.data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('tanks.history.prev')}</SecondaryButton>
            <span className="num px-2 text-sm text-muted">{t('tanks.history.page', { page: state.data.page, last: state.data.lastPage })}</span>
            <SecondaryButton disabled={state.data.page >= state.data.lastPage} onClick={() => setPage((value) => value + 1)}>{t('tanks.history.next')}</SecondaryButton>
          </nav>
        </>
      ) : null}
    </SectionCard>
  );
}

function Detail({ station, tankId }: { station: Station; tankId: string }) {
  const t = useTranslations('stationOps');
  const access = useTanksAccess();
  const levels = useTankLevels(station);
  const [version, setVersion] = useState(0);
  const { state } = levels;
  // أثناء إعادة الجلب بعد حفظ ناجح نُبقي آخر بيانات معروضة (لا يُفكَّك النموذج ولا يضيع إشعار «تم الحفظ»)؛ التحميل الأول فقط يُظهر هيكل التحميل.
  const lastRow = useRef<TankLevel | null>(null);
  if (state.status === 'success') lastRow.current = state.data.find((item) => item.tank.id === tankId) ?? null;
  const row = state.status === 'success' || state.status === 'loading' ? lastRow.current : null;

  if (state.status === 'loading' && !row) return <LoadingBlock rows={3} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={levels.reload} />;
  if (!row) return <ErrorState error={new StationOpsError('not_found', 404)} />;

  return (
    <>
      <SectionCard>
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-text">{row.tank.name}</h2>
            <p className="truncate text-sm text-muted">{[row.fuel_product.name, row.tank.code].filter(Boolean).join(' · ')}</p>
          </div>
          <FreshnessBadge freshness={row.level.freshness} />
        </div>
        <LevelSummary row={row} timeZone={station.timezone} />
        <p className="mt-3 text-xs leading-5 text-muted">
          {row.level.stale_after_minutes === null ? t('tanks.card.noPolicy') : t('tanks.card.stalePolicy', { value: String(row.level.stale_after_minutes) })}
        </p>
        {row.tank.status === 'maintenance' ? <p className="mt-1 text-xs leading-5 text-warning">{t('tanks.detail.tankMaintenance')}</p> : null}
      </SectionCard>

      {access.record ? (
        <RecordForm station={station} row={row} onSaved={() => { levels.reload(); setVersion((value) => value + 1); }} />
      ) : (
        <p data-view-only="" className="rounded-[12px] bg-primary-soft px-3.5 py-3 text-sm leading-6 text-text">{t('tanks.detail.viewOnly')}</p>
      )}

      <History key={version} station={station} tankId={tankId} />
    </>
  );
}

export function TankDetailScreen({ id }: { id: string }) {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tanks.title')} subtitle={t('tanks.subtitle')} backHref={TANKS_BASE} backLabel={t('tanks.detail.back')} />
      <ScreenBody>
        <StationGate>{(station) => <Detail station={station} tankId={id} />}</StationGate>
      </ScreenBody>
    </>
  );
}
