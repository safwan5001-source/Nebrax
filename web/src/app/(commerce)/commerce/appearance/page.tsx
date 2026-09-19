'use client';

import { useLocale } from 'next-intl';
import { ExperienceBuilder } from '@/modules/store-experience-builder/ExperienceBuilder';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';

export default function CommerceAppearancePage() {
  const locale = useLocale();
  const { catalog, selectedStoreId } = useCommerceStoreContext();
  const selectedStore =
    catalog.status === 'ready'
      ? catalog.stores.find((store) => store.id === selectedStoreId)
      : null;

  return (
    <div className="h-full min-h-0" data-store-experience-builder="">
      <ExperienceBuilder
        storefrontId={selectedStoreId}
        liveStoreName={selectedStore?.name ?? null}
        initialLocale={locale === 'en' ? 'en' : 'ar'}
      />
    </div>
  );
}
