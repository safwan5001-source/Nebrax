'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { EmptyState } from '@/components/nebrax';
import { ShieldAlert } from 'lucide-react';
import { useCan } from '@/lib/use-can';
import { useWholesaleChannel } from '../../channel-context';
import { SectionPage } from '../../components/section-page';
import { StatCard } from '../../components/stat-card';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { loadStoreCatalogCounts, type CatalogCounts } from './api';
import { AvailabilityPanel } from './availability-panel';
import { catalogMessages } from './messages';
import { PublicationPanel } from './publication-panel';

export function CatalogSection() {
  const locale = useLocale();
  const { t } = catalogMessages.forLocale(locale);
  return (
    <SectionPage sectionKey="catalog" description={t('description')}>
      <CatalogBody />
    </SectionPage>
  );
}

function CatalogBody() {
  const locale = useLocale();
  const { t } = catalogMessages.forLocale(locale);
  const { store } = useWholesaleChannel();
  const { can } = useCan();
  const [tab, setTab] = useState<'visibility' | 'availability'>('visibility');
  const [counts, setCounts] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CatalogCounts }>({ status: 'loading' });
  const seq = useRef(0);
  const storeId = store?.id ?? null;

  const loadCounts = useCallback(() => {
    if (!storeId) return;
    const id = ++seq.current;
    loadStoreCatalogCounts(storeId).then(
      (data) => id === seq.current && setCounts({ status: 'ready', data }),
      () => id === seq.current && setCounts({ status: 'error' }),
    );
  }, [storeId]);
  useEffect(() => loadCounts(), [loadCounts]);

  if (!store) return null;
  const stat = (key: keyof CatalogCounts) => ({
    loading: counts.status === 'loading',
    unavailable: counts.status === 'error' ? t('statsError') : undefined,
    value: counts.status === 'ready' ? counts.data[key] : undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('statAll')} {...stat('all')} />
        <StatCard label={t('statPublished')} {...stat('published')} />
        <StatCard label={t('statUnpublished')} {...stat('unpublished')} />
      </div>

      <div className="rounded border border-border bg-surface">
        <span className="sr-only" id="catalog-tabs-label">{t('tabsAria')}</span>
        <Tabs
          tabs={[
            { id: 'visibility', label: t('tabVisibility') },
            { id: 'availability', label: t('tabAvailability') },
          ]}
          value={tab}
          onChange={(id) => setTab(id as typeof tab)}
        />
        <div className="p-3">
          <TabPanel id={tab}>
            {tab === 'visibility' ? (
              <PublicationPanel key={store.id} storeId={store.id} storeName={store.name} onChanged={loadCounts} />
            ) : can('commerce.manage') ? (
              <AvailabilityPanel key={store.id} storeId={store.id} />
            ) : (
              <EmptyState icon={ShieldAlert} title={t('availabilityForbidden')} />
            )}
          </TabPanel>
        </div>
      </div>

      <UnavailablePanel title={t('unitsTitle')} description={t('unitsBody')} blocker={t('unitsBlocker')} reference={t('unitsReference')} />
    </div>
  );
}
