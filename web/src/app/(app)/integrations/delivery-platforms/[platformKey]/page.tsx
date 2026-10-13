'use client';

import { useParams } from 'next/navigation';
import { DeliveryPlatformDetail, UnknownDeliveryPlatform } from '@/components/integrations/delivery-platform-detail';
import { useDeliveryIntegrationData } from '@/components/integrations/use-delivery-integration-data';
import { deliveryLadder, isKnownDeliveryPlatform } from '@/lib/integration-center';

/**
 * تفاصيل منصة توصيل داخل مركز التكاملات (INT-UX-2). المفتاح يُتحقَّق منه مقابل السجلّ
 * المركزي **قبل** أي طلب: مفتاح غير معروف = صفحة «غير موجود» بصفر طلبات.
 */
export default function DeliveryPlatformDetailPage() {
  const params = useParams<{ platformKey: string }>();
  const raw = params?.platformKey;
  const platformKey = typeof raw === 'string' ? raw : '';
  const known = isKnownDeliveryPlatform(platformKey);
  const data = useDeliveryIntegrationData(known);

  if (!known) return <UnknownDeliveryPlatform />;

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
