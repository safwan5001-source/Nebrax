import { notFound } from 'next/navigation';
import { DeliveryPlatformDetailScreen } from '@/components/integrations/delivery-platform-detail-screen';
import { isKnownDeliveryPlatform } from '@/lib/integration-center';

/**
 * تفاصيل منصة توصيل داخل مركز التكاملات (INT-UX-2). مكوّن خادم: المفتاح يُتحقَّق منه مقابل السجلّ
 * المركزي **قبل** أي رسم أو طلب، ومفتاح غير معروف يستدعي `notFound()` فتخرج الاستجابة بـHTTP 404
 * حقيقية (وتُرسم `not-found.tsx` المجاورة)، لا صفحة 200 تقول «غير موجود».
 * `params` وعد في Next 15.
 */
export default async function DeliveryPlatformDetailPage({ params }: { params: Promise<{ platformKey: string }> }) {
  const { platformKey } = await params;
  if (!isKnownDeliveryPlatform(platformKey)) notFound();

  return <DeliveryPlatformDetailScreen platformKey={platformKey} />;
}
