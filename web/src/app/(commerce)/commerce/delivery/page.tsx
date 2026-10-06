'use client';

import { useLocale } from 'next-intl';
import { Truck } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { DeliveryWorkspace } from '@/modules/commerce-workspace/flowers-admin/delivery-workspace';
import { flowersAdminT } from '@/modules/commerce-workspace/flowers-admin/messages';
import { StoreGate } from '@/modules/commerce-workspace/flowers-admin/store-gate';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';

/**
 * FLOWERS-H2-2 / ADR-19 — «التوصيل وإعدادات القناة»: جدولة التسليم لمتجر القناة المحدَّد. القراءة والكتابة
 * كلتاهما `commerce.manage` في الخادم، فمن لا يملكها يرى حالة صلاحية ولا يُرسَل أي طلب.
 */
export default function CommerceDeliveryPage() {
  const locale = useLocale();
  const t = flowersAdminT(locale);
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={commerceWorkspaceMessage(locale, 'title')}
        title={commerceWorkspaceMessage(locale, 'delivery')}
        description={t('schedDescription')}
      />
      {canManage ? (
        <StoreGate>{(store) => <DeliveryWorkspace key={store.id} storeId={store.id} locale={locale} />}</StoreGate>
      ) : (
        <EmptyState icon={Truck} title={t('forbidden')} />
      )}
    </div>
  );
}
