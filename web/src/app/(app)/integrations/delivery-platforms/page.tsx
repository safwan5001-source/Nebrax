'use client';

import { DeliveryPlatformCatalog } from '@/components/integrations/delivery-platform-catalog';
import { useDeliveryIntegrationData } from '@/components/integrations/use-delivery-integration-data';
import { deliveryLadder, deliveryPlatformKeys } from '@/lib/integration-center';

/**
 * الإعدادات › مركز التكاملات › منصات التوصيل (INT-UX-2). قراءة فقط.
 * الجاهزية من `GET /delivery-platforms/readiness`، والإسناد اليدوي من `GET /delivery-platforms`.
 */
export default function DeliveryPlatformsCatalogPage() {
  const data = useDeliveryIntegrationData();
  const ladders = deliveryPlatformKeys().map((key) => deliveryLadder(key, data.manual, data.readiness));

  return (
    <DeliveryPlatformCatalog
      access={data.access}
      loading={data.status === 'loading'}
      ladders={ladders}
      manualFailed={data.manualFailed}
      readinessFailed={data.readinessFailed}
      canOpenApplications={data.canOpenApplications}
      onRetry={data.retry}
    />
  );
}
