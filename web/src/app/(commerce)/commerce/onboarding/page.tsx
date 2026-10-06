'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { flowersAdminT } from '@/modules/commerce-workspace/flowers-admin/messages';
import { OnboardingFlow } from '@/modules/commerce-workspace/flowers-admin/setup/onboarding-flow';
import { StoreGate } from '@/modules/commerce-workspace/flowers-admin/store-gate';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useOptionalCommerceStoreContext } from '@/modules/commerce-workspace/store-context';

/**
 * FLOWERS-H2-12 — التهيئة الموجَّهة. تخصّ متجراً بملف «ورد وهدايا» ومن يملك `commerce.manage` (مسارات الإعداد كلها
 * بها)؛ غير ذلك يرى حالة صريحة ولا يصدر أي طلب. الإخفاء ليس الحارس الوحيد — المسارات تفرض الصلاحية.
 */
export default function CommerceOnboardingPage() {
  const locale = useLocale();
  const t = flowersAdminT(locale);
  const context = useOptionalCommerceStoreContext();
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');
  const selected =
    context && context.catalog.status === 'ready' ? context.catalog.stores.find((store) => store.id === context.selectedStoreId) : undefined;
  const header = <PageHeader eyebrow={commerceWorkspaceMessage(locale, 'title')} title={t('onbTitle')} description={t('onbDescription')} />;

  if (!canManage) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState title={t('forbidden')} />
      </div>
    );
  }
  if (selected && selected.businessVertical !== 'flowers_gifts') {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          title={t('setupNotFlowersTitle')}
          description={t('setupNotFlowersDescription')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/commerce/stores">
                {t('setupOpenStores')}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <StoreGate>{(store) => <OnboardingFlow key={store.id} storeId={store.id} locale={locale} />}</StoreGate>
    </div>
  );
}
