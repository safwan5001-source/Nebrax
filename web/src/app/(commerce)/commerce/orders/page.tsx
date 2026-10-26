'use client';

import { Suspense } from 'react';
import { useLocale } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { EmptyState, LoadingState, PageHeader } from '@/components/nebrax';
import { useCan } from '@/lib/use-can';
import { ordersMessages } from '@/modules/commerce-workspace/orders/messages';
import { OrdersList } from '@/modules/commerce-workspace/orders/orders-list';

/**
 * COMMERCE-ORDERS-O1b — قائمة طلبات المتجر للموظف (قراءة فقط) فوق `GET commerce/orders` (O1a). من لا يملك
 * `commerce.orders.view` يرى حالة صلاحية ولا يُرسَل أي طلب. الخادم يبقى السلطة (403 للمقيَّد بمخازن/القدرة المعطّلة).
 */
export default function CommerceOrdersPage() {
  const locale = useLocale();
  const { t } = ordersMessages(locale);
  const { can, hydrated } = useCan();
  // قبل الترطيب لا نعرف الجلسة: لا طلب ولا حكم صلاحية (يمنع وميض «ممنوع» ثم تحميل).
  const canView = can('commerce.orders.view');

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {!hydrated ? (
        <LoadingState variant="table" rows={5} />
      ) : canView ? (
        <Suspense fallback={<LoadingState variant="table" rows={5} />}>
          <OrdersList />
        </Suspense>
      ) : (
        <EmptyState icon={ClipboardList} title={t('forbidden')} description={t('forbiddenHint')} />
      )}
    </div>
  );
}
