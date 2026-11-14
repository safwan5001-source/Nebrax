'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { StationOption } from '../settings-client';
import { FILL_STATUSES, FILTERS_BY_REPORT, INVENTORY_STATUS_FILTERS, isPeriodReversed, type ReportFilters } from './logic';
import type { ReportKey } from './routes';

export interface OwnerOption { id: string; name: string }

/**
 * مرشّحات التقرير. **تُعرض فقط المرشّحات التي يدعمها التقرير** (`FILTERS_BY_REPORT`): تقرير الحساب الوسيط يقبل الفترة وحدها لأن أرصدة الأستاذ لا تُقيَّد بالمحطة/الصاحب/الحالة.
 * الفترة المعكوسة تُمنع هنا (لا طلب) برسالة صريحة. التغيير فوري (لا زر تطبيق) وتُعاد الصفحة إلى الأولى في الشاشة.
 */
export function ReportFiltersBar({ reportKey, filters, stations, owners, onChange, onClear }: {
  reportKey: ReportKey; filters: ReportFilters; stations: StationOption[]; owners: OwnerOption[];
  onChange: (patch: Partial<ReportFilters>) => void; onClear: () => void;
}) {
  const t = useTranslations('fuelTankerReports');
  const f = useTranslations('fuelTankerFills');
  const allowed = FILTERS_BY_REPORT[reportKey];
  const reversed = isPeriodReversed(filters.from, filters.to);
  const active = Boolean(filters.stationId || filters.ownerId || filters.status || filters.inventoryStatus || filters.from || filters.to);
  const field = 'flex flex-col gap-1 text-sm';

  return (
    <form className="space-y-2" aria-label={t('filters.title')} data-report-filters="" onSubmit={(event) => event.preventDefault()}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {allowed.includes('station') ? (
          <label className={field}><span className="text-muted">{t('filters.station')}</span>
            <Select className="max-md:min-h-11" value={filters.stationId ?? ''} onChange={(e) => onChange({ stationId: e.target.value || undefined })} data-filter="station">
              <option value="">{t('filters.allStations')}</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
            </Select>
          </label>
        ) : null}
        {allowed.includes('owner') ? (
          <label className={field}><span className="text-muted">{t('filters.owner')}</span>
            <Select className="max-md:min-h-11" value={filters.ownerId ?? ''} onChange={(e) => onChange({ ownerId: e.target.value || undefined })} data-filter="owner">
              <option value="">{t('filters.allOwners')}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </label>
        ) : null}
        {allowed.includes('inventoryStatus') ? (
          <label className={field}><span className="text-muted">{t('filters.inventoryStatus')}</span>
            <Select className="max-md:min-h-11" value={filters.inventoryStatus ?? ''} onChange={(e) => onChange({ inventoryStatus: e.target.value || undefined })} data-filter="inventory_status">
              <option value="">{t('filters.allStatuses')}</option>
              {INVENTORY_STATUS_FILTERS.map((s) => <option key={s} value={s}>{f(`inventoryStatus.${s}`)}</option>)}
            </Select>
          </label>
        ) : null}
        {allowed.includes('status') ? (
          <label className={field}><span className="text-muted">{t('filters.fillStatus')}</span>
            <Select className="max-md:min-h-11" value={filters.status ?? ''} onChange={(e) => onChange({ status: e.target.value || undefined })} data-filter="status">
              <option value="">{t('filters.allFillStatuses')}</option>
              {FILL_STATUSES.map((s) => <option key={s} value={s}>{t(`filters.fillStatusValue.${s}`)}</option>)}
            </Select>
          </label>
        ) : null}
        {allowed.includes('period') ? (
          <>
            <label className={field}><span className="text-muted">{t('filters.from')}</span>
              <Input type="date" dir="ltr" className="max-md:min-h-11" value={filters.from ?? ''} max={filters.to || undefined} onChange={(e) => onChange({ from: e.target.value || undefined })} data-filter="from" aria-invalid={reversed || undefined} />
            </label>
            <label className={field}><span className="text-muted">{t('filters.to')}</span>
              <Input type="date" dir="ltr" className="max-md:min-h-11" value={filters.to ?? ''} min={filters.from || undefined} onChange={(e) => onChange({ to: e.target.value || undefined })} data-filter="to" aria-invalid={reversed || undefined} />
            </label>
          </>
        ) : null}
      </div>
      {reversed ? <p role="alert" className="text-sm text-negative" data-period-error="">{t('filters.periodReversed')}</p> : null}
      {reportKey === 'clearing-account' ? <p className="text-xs text-muted" data-no-row-filters="">{t('filters.clearingNote')}</p> : null}
      {active ? <Button type="button" variant="outline" size="sm" className="max-md:min-h-11" onClick={onClear} data-clear-filters="">{t('filters.clear')}</Button> : null}
    </form>
  );
}
