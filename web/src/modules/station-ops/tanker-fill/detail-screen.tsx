'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { isStationSession } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/toast';
import { TankerFillAttachments } from '@/modules/fuel-tankers/attachments/tanker-fill-attachments';
import { useStationAssets } from '../data';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { StationGate } from '../station-gate';
import { EmptyState, ErrorState, InlineNote, LoadingBlock } from '../state-views';
import { isValidFillId } from './client';
import { useFill, useTankerFillAccess, useTankerFillFeature } from './data';
import { litersFromMl } from './logic';
import { FillStatusBadge, Liters, NoStockNote, TANKER_BASE, When } from './parts';
import { SectionCard } from '../write-ui';

/**
 * TANKER-PR7 — تفاصيل سند تعبئة (قراءة فقط): الرقم الإلكتروني والسند الورقي حقلان منفصلان، الفوهة والمنتج والخزان، الحالة («بانتظار الدمج المخزني» — لا خصم مخزني بالتسجيل)،
 * وتجاوز السعة المؤكَّد إن وُجد. **لا إلغاء ولا ترحيل ولا عكس ولا مبالغ** (جلسة PIN لا تصلها). المرفقات: المكوّن الجاهز لجلسة أَوْج الكاملة فقط؛ لجلسة PIN نص صريح
 * (مسارات المرفقات غير مضافة لقائمة جلسة PIN البيضاء — توسيعها قرار مالك معلّق).
 */
export function TankerFillDetailScreen({ id }: { id: string }) {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tankerFill.detail.title')} backHref={TANKER_BASE} backLabel={t('tankerFill.backToList')} />
      <ScreenBody>
        <StationGate>{(station) => <Detail station={station} id={id} />}</StationGate>
      </ScreenBody>
    </>
  );
}

function Detail({ station, id }: { station: Station; id: string }) {
  const t = useTranslations('stationOps');
  const access = useTankerFillAccess();
  const feature = useTankerFillFeature(station);
  const valid = isValidFillId(id);
  const fill = useFill(station, valid ? id : '00000000-0000-0000-0000-000000000000');
  const assets = useStationAssets(station);

  // المضخة والخزان والمنتج تُحلّ من **معرّفات السند المخزَّنة** لا من تكوين الفوهة الحالي (الفوهة قد تُعاد نسبتها بعد التسجيل فيُحرَّف السند التاريخي).
  const equipment = useMemo(() => {
    if (fill.state.status !== 'success' || assets.state.status !== 'success') return null;
    const row = fill.state.data;
    const data = assets.state.data;
    return {
      pump: data.pumps.find((pump) => pump.id === row.fuel_pump_id)?.pump_number ?? null,
      nozzle: data.nozzles.find((nozzle) => nozzle.id === row.fuel_nozzle_id)?.nozzle_number ?? null,
      product: data.products.find((product) => product.id === row.fuel_product_id)?.name ?? null,
      tank: data.tanks.find((tank) => tank.id === row.fuel_tank_id)?.name ?? null,
    };
  }, [fill.state, assets.state]);

  if (!access.view) return <EmptyState title={t('tankerFill.noAccess.title')} body={t('tankerFill.noAccess.body')} />;
  if (!valid) return <ErrorState error={new StationOpsError('not_found', 404)} />;
  if (feature.state === 'closed') return <EmptyState title={t('tankerFill.closed.title')} body={t('tankerFill.closed.body')} />;
  if (fill.state.status === 'loading' || feature.state === 'checking') return <div className="pt-5"><LoadingBlock rows={3} /></div>;
  if (fill.state.status === 'error') return <div className="pt-5"><ErrorState error={fill.state.error} onRetry={fill.reload} /></div>;

  const row = fill.state.data;
  const rows: Array<[string, ReactNode]> = [
    [t('tankerFill.field.number'), <span key="n" className="num" dir="ltr" data-fill-number="">{row.number}</span>],
    [t('tankerFill.field.voucher'), <span key="v" className="num" dir="ltr" data-fill-voucher="">{row.voucher_number}</span>],
    [t('tankerFill.field.status'), <FillStatusBadge key="s" fill={row} />],
    [t('tankerFill.field.owner'), row.owner?.name ?? '—'],
    [t('tankerFill.field.tanker'), row.tanker ? <bdi key="p">{row.tanker.plate_number}</bdi> : t('tankerFill.review.noTanker')],
    [t('tankerFill.field.pump'), <span key="u" className="num" dir="ltr">{equipment?.pump ?? '—'}</span>],
    [t('tankerFill.field.nozzle'), <span key="z" className="num" dir="ltr">{equipment?.nozzle ?? '—'}</span>],
    [t('tankerFill.field.product'), equipment?.product ?? '—'],
    [t('tankerFill.field.tank'), equipment?.tank ?? '—'],
    [t('tankerFill.field.quantity'), <Liters key="q" ml={row.quantity_milliliters} />],
    [t('tankerFill.field.recordedAt'), <When key="t" value={row.recorded_at} timeZone={station.timezone} />],
  ];
  const overrun = row.capacity_overrun_milliliters ?? 0;
  const pin = isStationSession();

  return (
    <div className="space-y-4 pt-5" data-tanker-detail="" data-fill-id={row.id}>
      <NoStockNote />
      <SectionCard>
        <dl className="divide-y divide-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2.5"><dt className="text-muted">{label}</dt><dd className="min-w-0 text-end font-semibold text-text">{value}</dd></div>
          ))}
        </dl>
        {overrun > 0 ? <p className="mt-2 text-sm text-warning" data-detail-overrun="">{t('tankerFill.detail.overrun', { overrun: litersFromMl(overrun) })}</p> : null}
      </SectionCard>
      {row.status === 'voided' ? <InlineNote tone="warning">{t('tankerFill.detail.voided')}</InlineNote> : null}

      <SectionCard title={t('tankerFill.attachments.title')}>
        {pin ? (
          <div data-attachments-pin="" className="space-y-1 text-sm leading-6">
            <p className="text-text">{t('tankerFill.attachments.count', { count: row.attachments_count ?? 0 })}</p>
            <p className="text-muted">{t('tankerFill.attachments.pinNote')}</p>
          </div>
        ) : (
          <ToastProvider>
            <TankerFillAttachments fillId={row.id} branchId={station.branch_id} />
          </ToastProvider>
        )}
      </SectionCard>
    </div>
  );
}
