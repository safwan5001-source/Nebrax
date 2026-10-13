'use client';

import { DeliveryPlatformDetail } from './delivery-platform-detail';
import { useDeliveryIntegrationData } from './use-delivery-integration-data';
import { deliveryLadder } from '@/lib/integration-center';

/**
 * شاشة تفاصيل منصة توصيل معروفة (INT-UX-2). مفتاح المنصة يصلها من صفحة الخادم بعد التحقق منه
 * مقابل السجلّ المركزي، فلا تُنشأ هنا أي حالة «منصة غير معروفة» ولا يُطلب أي بيان لمفتاح مجهول.
 */
export function DeliveryPlatformDetailScreen({ platformKey }: { platformKey: string }) {
  const data = useDeliveryIntegrationData();

  return (
    <DeliveryPlatformDetail
      platformKey={platformKey}
      access={data.access}
      loading={data.status === 'loading'}
      ladder={deliveryLadder(platformKey, data.manual, data.readiness)}
      readiness={data.readiness?.get(platformKey) ?? null}
      manualFailed={data.manualFailed}
      readinessFailed={data.readinessFailed}
      canOpenApplications={data.canOpenApplications}
      canViewHub={data.canViewHub}
      canViewReport={data.canViewReport}
      canViewEvidence={data.canViewEvidence}
      onRetry={data.retry}
    />
  );
}
