'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { AssignPanel } from '@/modules/commerce-workspace/merchandising/assign-panel';
import { CollectionsPanel } from '@/modules/commerce-workspace/merchandising/collections-panel';
import type { MessageKey } from '@/modules/commerce-workspace/merchandising/common';
import { FacetsPanel } from '@/modules/commerce-workspace/merchandising/facets-panel';

type Tab = 'facets' | 'collections' | 'products';

/**
 * FLOWERS-H2 / ADR-14 — التسويق والتصنيف: أبعاد الترشيح (مناسبة، مُهدى إليه…)،
 * المجموعات اليدوية، وإسناد المنتجات. الخادم سلطة الملكية والتحقق؛ هذه الواجهة
 * تعرض وتكتب فقط عبر `commerce/workspace/*` بصلاحيتَي `products.view/manage`.
 */
export default function CommerceMerchandisingPage() {
  const locale = useLocale();
  const t = (key: MessageKey) => commerceWorkspaceMessage(locale, key);
  const [tab, setTab] = useState<Tab>('facets');

  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'products.manage');

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('title')} title={t('merchandising')} description={t('merchandisingDescription')} />

      {!canManage ? <p className="rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{t('merchNoPermission')}</p> : null}

      <Tabs
        tabs={[
          { id: 'facets', label: t('merchTabFacets') },
          { id: 'collections', label: t('merchTabCollections') },
          { id: 'products', label: t('merchTabProducts') },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'facets' ? (
        <TabPanel id="facets">
          <FacetsPanel t={t} canManage={canManage} />
        </TabPanel>
      ) : null}
      {tab === 'collections' ? (
        <TabPanel id="collections">
          <CollectionsPanel t={t} canManage={canManage} />
        </TabPanel>
      ) : null}
      {tab === 'products' ? (
        <TabPanel id="products">
          <AssignPanel t={t} canManage={canManage} />
        </TabPanel>
      ) : null}
    </div>
  );
}
