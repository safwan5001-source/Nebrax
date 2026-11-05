'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CircleCheck, CircleDashed, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { StationCatalog } from './catalog';
import { formatLitersFixedFromMl, formatStampInZone } from './format';
import { Quantity } from './quantity';
import { buildTankRows, type NozzleReadingRow, type NozzleReadingStatus, type PumpReadingGroup, type ShiftReadingsView } from './readings';
import type { ShiftDetail, TankReading } from './schemas';
import { EmptyState, InlineNote } from './state-views';

/**
 * UI-1 — قسما «قراءات العدادات» و«قراءات الخزانات» (قراءة فقط). الأرقام من تفاصيل الوردية وحدها؛ الغياب حالة مسمّاة
 * (لم تُسجَّل / بانتظار الإغلاق) ولا يُملأ صفراً. حالة كل فوهة نص + أيقونة، لا لون وحده.
 */

const STATUS_VIEW: Record<NozzleReadingStatus, { Icon: LucideIcon; tone: string }> = {
  complete: { Icon: CircleCheck, tone: 'bg-[color:var(--fo-positive-tint)] text-positive' },
  awaiting_closing: { Icon: Clock, tone: 'bg-[color:var(--fo-warning-tint)] text-warning' },
  closing_without_opening: { Icon: TriangleAlert, tone: 'bg-[color:var(--fo-warning-tint)] text-warning' },
  not_recorded: { Icon: CircleDashed, tone: 'border border-border text-muted' },
  invalid_order: { Icon: TriangleAlert, tone: 'bg-[color:var(--fo-negative-tint)] text-negative' },
};

function StatusChip({ status, shiftOpen }: { status: NozzleReadingStatus; shiftOpen: boolean }) {
  const t = useTranslations('stationOps');
  const { Icon, tone } = STATUS_VIEW[status];
  const key = status === 'awaiting_closing' ? (shiftOpen ? 'awaiting_closing_open' : 'awaiting_closing_closed') : status;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {t(`shiftDetail.readings.status.${key}`)}
    </span>
  );
}

function Reading({ label, ml, at, locale, timeZone, missing }: { label: string; ml: number | null; at: string | null; locale: string; timeZone?: string | null; missing: string }) {
  const t = useTranslations('stationOps');
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      {ml === null ? (
        <dd className="mt-0.5 text-sm text-muted">{missing}</dd>
      ) : (
        <>
          <dd className="mt-0.5 text-[15px] font-semibold text-text"><Quantity value={formatLitersFixedFromMl(ml, locale)} unit={t('unit.liter')} /></dd>
          <dd className="mt-0.5 text-xs text-muted tabular-nums">{formatStampInZone(at, locale, timeZone)}</dd>
        </>
      )}
    </div>
  );
}

function NozzleRow({ row, shiftOpen, locale, timeZone }: { row: NozzleReadingRow; shiftOpen: boolean; locale: string; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const view = row.view;
  const missing = t('shiftDetail.readings.notRecorded');
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-text">
            {view ? <>{t('products.nozzle')} <span className="num">{view.nozzle.nozzle_number}</span></> : t('shiftDetail.readings.unknownNozzle')}
            {view ? <span className="font-normal text-muted"> · {view.product?.name ?? t('products.unknownProduct')}</span> : null}
          </p>
          {view?.tank ? <p className="mt-0.5 text-xs text-muted">{view.tank.name}</p> : null}
          {view?.blockedBy ? <p className="mt-0.5 text-xs text-warning">{t('shiftDetail.readings.blockedNow', { reason: t(`blocked.${view.blockedBy}`) })}</p> : null}
        </div>
        <StatusChip status={row.status} shiftOpen={shiftOpen} />
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Reading label={t('shiftDetail.readings.opening')} ml={row.opening?.meter_milliliters ?? null} at={row.opening?.measured_at ?? null} locale={locale} timeZone={timeZone} missing={missing} />
        <Reading label={t('shiftDetail.readings.closing')} ml={row.closing?.meter_milliliters ?? null} at={row.closing?.measured_at ?? null} locale={locale} timeZone={timeZone} missing={missing} />
        <div className="col-span-2 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
          <dt className="text-xs text-muted">{t('shiftDetail.readings.computed')}</dt>
          {row.deltaMl !== null ? (
            <dd className="text-base font-bold text-text"><Quantity value={formatLitersFixedFromMl(row.deltaMl, locale)} unit={t('unit.liter')} /></dd>
          ) : (
            <dd className="text-sm text-muted">{row.status === 'invalid_order' ? t('shiftDetail.readings.invalidDetail') : '—'}</dd>
          )}
        </div>
      </dl>
    </li>
  );
}

function PumpCard({ group, shiftOpen, locale, timeZone }: { group: PumpReadingGroup; shiftOpen: boolean; locale: string; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  return (
    <li className="rounded-[14px] border border-border bg-surface px-4 pt-3.5">
      <h3 className="text-base font-semibold text-text">
        {group.pump ? <>{t('products.pump')} <span className="num">{group.pump.pump_number}</span>{group.pump.name ? ` · ${group.pump.name}` : ''}</> : t('shiftDetail.readings.unknownPump')}
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {group.rows.map((row) => <NozzleRow key={row.nozzleId} row={row} shiftOpen={shiftOpen} locale={locale} timeZone={timeZone} />)}
      </ul>
    </li>
  );
}

export function ReadingsSection({ view, shiftOpen, timeZone }: { view: ShiftReadingsView; shiftOpen: boolean; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const empty = view.groups.length === 0 && view.outsideSetup.length === 0;
  return (
    <section aria-labelledby="fo-readings-h" className="space-y-3">
      <h2 id="fo-readings-h" className="text-base font-semibold text-text">{t('shiftDetail.readings.title')}</h2>
      {empty ? (
        <EmptyState title={t('shiftDetail.readings.empty.title')} body={t('shiftDetail.readings.empty.body')} />
      ) : (
        <>
          <ul className="space-y-3">
            {view.groups.map((group) => <PumpCard key={group.key} group={group} shiftOpen={shiftOpen} locale={locale} timeZone={timeZone} />)}
          </ul>
          {view.outsideSetup.length > 0 ? (
            <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 pt-3.5">
              <h3 className="text-base font-semibold text-text">{t('shiftDetail.readings.outside.title')}</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{t('shiftDetail.readings.outside.body')}</p>
              <ul className="mt-1 divide-y divide-border">
                {view.outsideSetup.map((row) => <NozzleRow key={row.nozzleId} row={row} shiftOpen={shiftOpen} locale={locale} timeZone={timeZone} />)}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <InlineNote>{t('shiftDetail.readings.setupNote')}</InlineNote>
    </section>
  );
}

function TankReadingCell({ label, reading, locale, timeZone }: { label: string; reading: TankReading | null; locale: string; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const kind = reading?.reading_type === 'physical' || reading?.reading_type === 'atg' ? t(`shiftDetail.tanks.type.${reading.reading_type}`) : reading?.reading_type;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      {reading ? (
        <>
          <dd className="mt-0.5 text-[15px] font-semibold text-text"><Quantity value={formatLitersFixedFromMl(reading.quantity_milliliters, locale)} unit={t('unit.liter')} /></dd>
          <dd className="mt-0.5 text-xs text-muted">{kind}</dd>
          <dd className="text-xs text-muted tabular-nums">{formatStampInZone(reading.measured_at, locale, timeZone)}</dd>
        </>
      ) : (
        <dd className="mt-0.5 text-sm text-muted">{t('shiftDetail.tanks.notRecorded')}</dd>
      )}
    </div>
  );
}

export function TanksSection({ detail, catalog, timeZone }: { detail: ShiftDetail; catalog: StationCatalog | null; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const rows = buildTankRows(detail);
  const names = new Map((catalog?.tanks ?? []).map(({ tank, product }) => [tank.id, { name: tank.name, product: product?.name ?? null }]));
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <InlineNote>{t('shiftDetail.tanks.empty')}</InlineNote>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const known = names.get(row.tankId);
            return (
              <li key={row.tankId} className="rounded-[12px] border border-border p-3.5">
                <p className="text-base font-semibold text-text">{known?.name ?? t('shiftDetail.tanks.unknownTank')}</p>
                {known?.product ? <p className="mt-0.5 text-xs text-muted">{known.product}</p> : null}
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <TankReadingCell label={t('shiftDetail.tanks.opening')} reading={row.opening} locale={locale} timeZone={timeZone} />
                  <TankReadingCell label={t('shiftDetail.tanks.closing')} reading={row.closing} locale={locale} timeZone={timeZone} />
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      <InlineNote>{t('shiftDetail.tanks.note')}</InlineNote>
    </div>
  );
}
