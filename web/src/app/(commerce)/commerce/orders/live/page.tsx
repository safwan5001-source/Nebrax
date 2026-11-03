'use client';

import { useLocale } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { EmptyState, LoadingState, PageHeader } from '@/components/nebrax';
import { useCan } from '@/lib/use-can';
import { receptionMessages } from '@/modules/commerce-workspace/reception/messages';
import { ReceptionBoard } from '@/modules/commerce-workspace/reception/reception-board';

/**
 * COPS-H3-5 — مساحة استقبال الطلبات الحية. من لا يملك `commerce.orders.view` يرى حالة صلاحية ولا يُرسَل أي طلب. الخادم يبقى السلطة
 * (المقيَّد بمخازن يرى طلبات مخازنه فقط؛ القدرة المعطّلة ⇒ 403).
 */
export default function CommerceOrdersLivePage() {
  const locale = useLocale();
  const { t } = receptionMessages(locale);
  const { can, hydrated } = useCan();

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {!hydrated ? (
        <LoadingState variant="cards" rows={3} />
      ) : can('commerce.orders.view') ? (
        <ReceptionBoard />
      ) : (
        <EmptyState icon={ClipboardList} title={t('forbidden')} description={t('forbiddenHint')} />
      )}
    </div>
  );
}
