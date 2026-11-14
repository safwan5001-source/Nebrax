'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { LinkCard } from '../admin/ui';
import { useCurrentShift } from '../data';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { StationGate } from '../station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from '../state-views';
import { SecondaryButton } from '../write-ui';
import { useShiftFills, useTankerFillAccess, useTankerFillFeature } from './data';
import { FillStatusBadge, Liters, NoStockNote, TANKER_BASE, When } from './parts';
import type { TankerFill } from './schemas';

/**
 * TANKER-PR7 — سجل تعبئات الصهاريج **للوردية الحالية** (قراءة فقط) داخل التطبيق: السند الإلكتروني والورقي والصاحب والكمية والحالة. الإجمالي من السندات المسجَّلة المحمَّلة فقط
 * (الملغى لا يُحتسب) ويُوسَم محدوداً إن وُجدت صفحات أخرى. السند لا يخصم المخزون — تنبيه ثابت أعلى القائمة.
 */
export function TankerFillListScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tankerFill.list.title')} subtitle={t('tankerFill.list.subtitle')} />
      <ScreenBody>
        <StationGate>{(station) => <List station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}

function Row({ fill, timeZone }: { fill: TankerFill; timeZone: string | null | undefined }) {
  const t = useTranslations('stationOps');
  const hint = [fill.owner?.name, fill.tanker?.plate_number].filter((part): part is string => !!part).join(' · ');
  return (
    <li className="space-y-1.5" data-fill-row="" data-fill-id={fill.id}>
      <LinkCard href={`${TANKER_BASE}/${encodeURIComponent(fill.id)}`} title={fill.number} hint={hint || t('tankerFill.review.noTanker')} trailing={<FillStatusBadge fill={fill} />} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-sm text-muted">
        <span>{t('tankerFill.field.voucher')}: <span className="num" dir="ltr">{fill.voucher_number}</span></span>
        <span><Liters ml={fill.quantity_milliliters} /></span>
        <When value={fill.recorded_at} timeZone={timeZone} />
      </div>
    </li>
  );
}

function List({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const access = useTankerFillAccess();
  const feature = useTankerFillFeature(station);
  const current = useCurrentShift(station);
  const shift = current.state.status === 'success' ? current.state.data.shift : null;
  const fills = useShiftFills(station, shift?.id ?? null);

  const recorded = useMemo(() => (fills.state.status === 'success' ? fills.state.data.rows.filter((fill) => fill.status === 'recorded') : []), [fills.state]);
  const totalMl = recorded.reduce((sum, fill) => sum + fill.quantity_milliliters, 0);

  if (!access.view) return <EmptyState title={t('tankerFill.noAccess.title')} body={t('tankerFill.noAccess.body')} />;
  if (feature.state === 'checking' || current.state.status === 'loading') return <LoadingBlock rows={3} />;
  if (feature.state === 'closed') return <EmptyState title={t('tankerFill.closed.title')} body={t('tankerFill.closed.body')} />;
  if (feature.state === 'forbidden') return <EmptyState title={t('tankerFill.noAccess.title')} body={t('tankerFill.noAccess.body')} />;
  if (feature.state === 'unavailable') return <ErrorState error={new StationOpsError('server')} onRetry={feature.reload} />;
  if (current.state.status === 'error') return <ErrorState error={current.state.error} onRetry={current.reload} />;

  return (
    <div className="space-y-4 pt-5" data-tanker-list="">
      <NoStockNote />
      {access.canStart && shift ? (
        <Link
          href={`${TANKER_BASE}/new`}
          data-primary-action=""
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
          {t('tankerFill.list.new')}
        </Link>
      ) : null}
      {!shift ? (
        <div data-no-open-shift="" className="space-y-3">
          <EmptyState title={t('tankerFill.noShift.title')} body={t('tankerFill.noShift.listBody')} />
          <SecondaryButton onClick={current.reload}>{t('write.check')}</SecondaryButton>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted" data-shift-line="">{t('tankerFill.list.shiftLine', { number: shift.number })}</p>
          {fills.state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
          {fills.state.status === 'error' ? <ErrorState error={fills.state.error} onRetry={fills.reload} /> : null}
          {fills.state.status === 'success' ? (
            <>
              <dl className="grid grid-cols-2 gap-3 rounded-[14px] border border-border bg-surface p-4 text-sm" data-totals="">
                <div><dt className="text-xs text-muted">{t('tankerFill.list.count')}</dt><dd className="num text-lg font-bold text-text" data-total-count="">{recorded.length}</dd></div>
                <div><dt className="text-xs text-muted">{t('tankerFill.list.total')}</dt><dd className="text-lg font-bold text-text" data-total-liters=""><Liters ml={totalMl} /></dd></div>
              </dl>
              {fills.state.data.truncated ? <InlineNote tone="warning">{t('tankerFill.list.truncated')}</InlineNote> : null}
              {fills.state.data.rows.length === 0 ? (
                <EmptyState title={t('tankerFill.list.emptyTitle')} body={t('tankerFill.list.emptyBody')} />
              ) : (
                <ul className="space-y-3">
                  {fills.state.data.rows.map((fill) => <Row key={fill.id} fill={fill} timeZone={station.timezone} />)}
                </ul>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
