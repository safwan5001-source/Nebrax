'use client';

import { DeliveryPlatformDetail } from './delivery-platform-detail';
import { useDeliveryIntegrationData } from './use-delivery-integration-data';
import type { IngressProfileSupport } from './ingress-create-entry';
import { useIngressManagement } from './use-ingress-management';
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

  // تدوير السر والتعطيل (INT-UX-5b): بعد أي نتيجة (أو نتيجة مجهولة) تُعاد قراءة قائمة النقاط.
  const profileId = data.profileIds?.get(platformKey) ?? null;
  const management = useIngressManagement(ingress.retry, profileId);
  const manualState = data.manual?.get(platformKey);
  const ingressProfile: IngressProfileSupport = {
    state: data.manualFailed || data.profileIds === null ? 'unreadable' : profileId !== null ? 'ready' : manualState === 'disabled' ? 'disabled' : 'missing',
    canSetup: data.canManageProfiles,
  };

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
      management={management}
      ingressProfile={ingressProfile}
      onRetry={data.retry}
    />
  );
}
