'use client';

import { DeliveryPlatformDetail } from './delivery-platform-detail';
import { useDeliveryIntegrationData } from './use-delivery-integration-data';
import { useSignedIngress } from './use-signed-ingress';
import { deliveryLadder } from '@/lib/integration-center';

/**
 * شاشة تفاصيل منصة توصيل معروفة (INT-UX-2). مفتاح المنصة يصلها من صفحة الخادم بعد التحقق منه
 * مقابل السجلّ المركزي، فلا تُنشأ هنا أي حالة «منصة غير معروفة» ولا يُطلب أي بيان لمفتاح مجهول.
 */
export function DeliveryPlatformDetailScreen({ platformKey }: { platformKey: string }) {
  const data = useDeliveryIntegrationData();
  // قراءة نقاط الاستقبال تبدأ بعد أن تتيح الصفحة الوصول وتنتهي قراءتاها، ولا تبدأ بلا `delivery_connector.view`.
  const ingress = useSignedIngress(platformKey, data.access === 'allowed' && data.status === 'ready', data.attempt);

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
      canManageProfiles={data.canManageProfiles}
      canViewHub={data.canViewHub}
      canViewReport={data.canViewReport}
      canViewEvidence={data.canViewEvidence}
      ingress={ingress.state}
      onIngressRetry={ingress.retry}
      onRetry={data.retry}
    />
  );
}
