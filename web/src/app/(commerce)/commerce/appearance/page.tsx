'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { ExperienceBuilder } from '@/modules/store-experience-builder/ExperienceBuilder';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { useCompany } from '@/lib/company';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { loadFacets } from '@/modules/commerce-workspace/merchandising/client';
import { loadVerticalSetup } from '@/modules/commerce-workspace/vertical-setup';
import { applyFlowersGiftSections, type PresentationHomeSection } from '@/modules/store-experience-builder/presentation';

export default function CommerceAppearancePage() {
  const locale = useLocale();
  const company = useCompany();
  // The query is read AFTER mount: on a client-side navigation (e.g. from the Theme Gallery) `window.location` is only updated once
  // the new page has committed, so reading it during render would miss `?version=` / `?previewTheme=`. The builder mounts once the
  // parameters are known, so it never loads twice.
  const [query, setQuery] = useState<{ versionId: string | null; previewThemeId: string | null } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery({
      versionId: params.get('version'),
      // CUST-HV V10b — `?previewTheme=<id>` opens the builder in Theme Preview (Preview → Apply summary → new Draft Version).
      previewThemeId: params.get('previewTheme'),
    });
  }, []);
  const { catalog, selectedStoreId, viewStoreUrl } = useCommerceStoreContext();
  const selectedStore =
    catalog.status === 'ready'
      ? catalog.stores.find((store) => store.id === selectedStoreId)
      : null;

  // FLOWERS-H15: a themed gift pack only adds what the store can really back, and never blocks the theme itself.
  async function themePackSections(sections: readonly PresentationHomeSection[]) {
    if (!selectedStoreId) return null;
    const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
    const [facets, setup] = await Promise.all([loadFacets(), loadVerticalSetup(selectedStoreId)]);
    const keyOf = (systemKey: 'occasion' | 'recipient') =>
      facets?.find((facet) => facet.systemKey === systemKey && facet.isActive)?.key ?? null;
    return applyFlowersGiftSections(sections, {
      facetKeys: { occasion: keyOf('occasion'), recipient: keyOf('recipient') },
      deliveryScheduleConfigured: setup?.items.find((item) => item.key === 'delivery_scheduling')?.state === 'configured',
      copy: {
        occasionTitle: t('bloomSectionOccasion'),
        recipientTitle: t('bloomSectionRecipient'),
        deliveryPromiseTitle: t('bloomSectionDelivery'),
      },
    });
  }

  return (
    <div className="h-full min-h-0" data-store-experience-builder="">
      {query ? <ExperienceBuilder
        storefrontId={selectedStoreId}
        liveStoreName={selectedStore?.name ?? null}
        businessIdentity={{
          legal_name: company?.name ?? null,
          cr_number: company?.cr_number ?? null,
          vat_number: company?.vat_number ?? null,
        }}
        initialLocale={locale === 'en' ? 'en' : 'ar'}
        storefrontUrl={viewStoreUrl}
        versionId={query.versionId}
        previewThemeId={query.previewThemeId}
        themePackSections={themePackSections}
      /> : null}
    </div>
  );
}
