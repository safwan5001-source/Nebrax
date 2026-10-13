import { UnknownDeliveryPlatform } from '@/components/integrations/delivery-platform-detail';

/** تُرسم عند `notFound()` من صفحة التفاصيل: صفحة «غير موجود» بعودة إلى الكتالوج، ضمن هيكل التطبيق. */
export default function DeliveryPlatformNotFound() {
  return <UnknownDeliveryPlatform />;
}
