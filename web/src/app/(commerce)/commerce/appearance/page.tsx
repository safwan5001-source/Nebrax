'use client';

import { useLocale } from 'next-intl';
import { ExperienceBuilder } from '@/modules/store-experience-builder/ExperienceBuilder';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { useCompany } from '@/lib/company';

export default function CommerceAppearancePage() {
  const locale = useLocale();
  const company = useCompany();
  const { catalog, selectedStoreId, viewStoreUrl } = useCommerceStoreContext();
  const selectedStore =
    catalog.status === 'ready'
      ? catalog.stores.find((store) => store.id === selectedStoreId)
      : null;

  return (
    <div className="h-full min-h-0" data-store-experience-builder="">
      <ExperienceBuilder
        storefrontId={selectedStoreId}
        liveStoreName={selectedStore?.name ?? null}
        businessIdentity={{
          legal_name: company?.name ?? null,
          cr_number: company?.cr_number ?? null,
          vat_number: company?.vat_number ?? null,
        }}
        initialLocale={locale === 'en' ? 'en' : 'ar'}
        storefrontUrl={viewStoreUrl}
      />
    </div>
  );
}
