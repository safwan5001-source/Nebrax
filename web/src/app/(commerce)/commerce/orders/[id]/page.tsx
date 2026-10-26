'use client';

import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { useCan } from '@/lib/use-can';
import { ordersMessages } from '@/modules/commerce-workspace/orders/messages';
import { OrderDetailView } from '@/modules/commerce-workspace/orders/order-detail';

/** COMMERCE-ORDERS-O1b — تفاصيل طلب متجر (قراءة فقط) فوق `GET commerce/orders/{id}`. */
export default function CommerceOrderDetailPage() {
  const locale = useLocale();
  const { t } = ordersMessages(locale);
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { can, hydrated } = useCan();
  // قبل الترطيب لا نعرف الجلسة: لا طلب ولا حكم صلاحية (يمنع وميض «ممنوع» ثم تحميل).
  const canView = can('commerce.orders.view');

  if (!hydrated) return <LoadingState variant="cards" rows={3} />;
  if (!canView) return <EmptyState icon={ClipboardList} title={t('forbidden')} description={t('forbiddenHint')} />;
  if (id === '') return <EmptyState icon={ClipboardList} title={t('detailNotFound')} description={t('detailNotFoundHint')} />;

  return <OrderDetailView id={id} />;
}
