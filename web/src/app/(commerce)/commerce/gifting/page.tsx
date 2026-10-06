'use client';

import { useLocale } from 'next-intl';
import { PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { GiftPolicyPanel } from '@/modules/commerce-workspace/flowers-admin/gift-policy-panel';
import { flowersAdminT } from '@/modules/commerce-workspace/flowers-admin/messages';
import { StoreGate } from '@/modules/commerce-workspace/flowers-admin/store-gate';
import { EmptyState } from '@/components/nebrax';
import { Gift } from 'lucide-react';

/**
 * FLOWERS-H2-1 / ADR-15 — «الإهداء»: سياسة الإهداء لمتجر القناة المحدَّد. القراءة والكتابة كلتاهما
 * `commerce.manage` في الخادم، فمن لا يملكها يرى حالة صلاحية بدل نموذجٍ سيفشل.
 */
export default function CommerceGiftingPage() {
  const locale = useLocale();
  const t = flowersAdminT(locale);
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={commerceWorkspaceMessage(locale, 'title')}
        title={t('giftTitle')}
        description={t('giftDescription')}
      />
      {canManage ? (
        <StoreGate>{(store) => <GiftPolicyPanel key={store.id} storeId={store.id} locale={locale} />}</StoreGate>
      ) : (
        <EmptyState icon={Gift} title={t('forbidden')} />
      )}
    </div>
  );
}
