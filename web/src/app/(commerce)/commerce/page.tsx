'use client';

import { useLocale } from 'next-intl';
import { CommerceDestinationPage, CoreLinksCard } from '@/components/commerce-workspace/commerce-destination-page';
import { PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { flowersAdminT } from '@/modules/commerce-workspace/flowers-admin/messages';
import { SetupCenter } from '@/modules/commerce-workspace/flowers-admin/setup/setup-center';
import { StoreGate } from '@/modules/commerce-workspace/flowers-admin/store-gate';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useOptionalCommerceStoreContext } from '@/modules/commerce-workspace/store-context';

/**
 * نظرة التجارة. لمتجرٍ بملف «ورد وهدايا» تعرض **مركز الإعداد** (حالة حقيقية لكل قدرة وما ينقصها وروابط تعمل)؛
 * لغيره تبقى كما كانت (لا إزعاج لمتاجر التجزئة العامة). الإعداد يحتاج `commerce.manage` (مساراته كلها بها).
 */
export default function CommerceOverviewPage() {
  const locale = useLocale();
  const context = useOptionalCommerceStoreContext();
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');
  const selected =
    context && context.catalog.status === 'ready' ? context.catalog.stores.find((store) => store.id === context.selectedStoreId) : undefined;

  if (!canManage || selected?.businessVertical !== 'flowers_gifts') {
    return <CommerceDestinationPage titleKey="overviewTitle" showCoreLinks />;
  }
  const t = flowersAdminT(locale);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={commerceWorkspaceMessage(locale, 'title')} title={t('setupTitle')} description={t('setupDescription')} />
      <StoreGate>{(store) => <SetupCenter key={store.id} storeId={store.id} locale={locale} />}</StoreGate>
      <CoreLinksCard />
    </div>
  );
}
