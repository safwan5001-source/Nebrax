'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { formatMinorRiyal } from '@/lib/money';
import { DeliveryWorkspace } from '@/modules/commerce-workspace/flowers-admin/delivery-workspace';
import { useWholesaleChannel } from '../../channel-context';
import { SectionPage } from '../../components/section-page';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { useResource } from '../../use-resource';
import { fetchShippingZones, type ShippingZoneRow } from './api';
import { shippingMessages } from './messages';

/**
 * Shipping & Delivery — reuses the existing delivery-schedule / fulfilment-warehouse workspace for the active store
 * (same endpoints, same server rules) and lists the company's shipping zones read-only. Wholesale-specific freight
 * and per-buyer delivery terms have no backend contract and are shown as deferred, not as controls.
 */
export function ShippingSection() {
  const locale = useLocale();
  const { t } = shippingMessages.forLocale(locale);
  const { store } = useWholesaleChannel();

  return (
    <SectionPage sectionKey="shipping" description={t('description')}>
      {store ? <ShippingBody key={store.id} storeId={store.id} storeName={store.name} /> : null}
    </SectionPage>
  );
}

function ShippingBody({ storeId, storeName }: { storeId: string; storeName: string }) {
  const locale = useLocale();
  const { t } = shippingMessages.forLocale(locale);

  return (
    <div className="space-y-6">
      <section aria-labelledby="ship-schedule-title" className="space-y-3">
        <div>
          <h2 id="ship-schedule-title" className="text-base font-semibold text-text">{t('scheduleTitle')}</h2>
          <p className="text-sm text-muted">{t('scheduleHint', { store: storeName })}</p>
        </div>
        <DeliveryWorkspace key={storeId} storeId={storeId} locale={locale} />
      </section>

      <ZonesTable />

      <div className="grid gap-3 lg:grid-cols-2">
        <UnavailablePanel title={t('deferredFreightTitle')} description={t('deferredFreightDescription')} blocker={t('deferredFreightBlocker')} />
        <UnavailablePanel
          title={t('deferredBuyerTitle')}
          description={t('deferredBuyerDescription')}
          blocker={t('deferredBuyerBlocker')}
          reference={t('deferredBuyerReference')}
        />
      </div>
    </div>
  );
}

function ZonesTable() {
  const locale = useLocale();
  const { t, label } = shippingMessages.forLocale(locale);
  const { state, reload } = useResource(fetchShippingZones, []);

  const columns = useMemo<ColumnDef<ShippingZoneRow, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('zoneName') },
      { id: 'type', header: t('zoneMatch'), accessorFn: (z) => label('zoneType', z.matchType) },
      { accessorKey: 'matchValue', header: t('zoneValue') },
      {
        id: 'rate',
        header: t('zoneRate'),
        accessorFn: (z) => z.rateMinor ?? 0,
        cell: ({ row }) => <span className="num">{row.original.rateMinor === null ? '—' : formatMinorRiyal(row.original.rateMinor)}</span>,
      },
      {
        id: 'status',
        header: t('zoneStatus'),
        enableSorting: false,
        cell: ({ row }) => <Badge tone={row.original.isActive ? 'positive' : 'muted'}>{row.original.isActive ? t('zoneActive') : t('zoneInactive')}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const rows = state.status === 'ready' ? state.data : [];

  return (
    <section aria-labelledby="ship-zones-title" className="space-y-3">
      <div>
        <h2 id="ship-zones-title" className="text-base font-semibold text-text">{t('zonesTitle')}</h2>
        <p className="text-sm text-muted">{t('zonesHint')}</p>
      </div>
      <DataTable<ShippingZoneRow>
        columns={columns}
        data={rows}
        loading={state.status === 'loading'}
        error={state.status === 'error' ? t('zonesLoadError') : null}
        onRetry={reload}
        showToolbar={false}
        emptyLabel={t('zonesEmpty')}
        emptyDescription={t('zonesEmptyHint')}
        mobileRecord={(z) => ({
          title: z.name,
          subtitle: `${label('zoneType', z.matchType)} · ${z.matchValue}`,
          amount: z.rateMinor === null ? '—' : formatMinorRiyal(z.rateMinor),
          amountLabel: t('zoneRate'),
          status: <Badge tone={z.isActive ? 'positive' : 'muted'}>{z.isActive ? t('zoneActive') : t('zoneInactive')}</Badge>,
        })}
      />
    </section>
  );
}
