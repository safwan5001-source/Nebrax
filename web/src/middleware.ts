import { NextResponse, type NextRequest } from 'next/server';
import { isKnownDeliveryPlatform } from '@/lib/integration-center';

/**
 * رمز HTTP 404 حقيقي لمفتاح منصة توصيل غير معروف (INT-UX-2).
 *
 * `notFound()` وحده لا يكفي هنا: هيكل `(app)` مكوّن عميل لا يستهلك `children` أثناء العرض على
 * الخادم، فيبدأ البث بحالة 200 قبل أن تُحَلّ الصفحة، وبعد بدء البث لا يتغيّر الرمز (توثيق Next.js:
 * «After streaming starts, the status code remains 200»). الفحص على مستوى الطلب قبل العرض هو
 * الآلية الموصوفة لذلك. المفتاح يُقارن بالسجلّ المركزي نفسه الذي تستعمله الواجهة، فلا قائمة ثانية.
 *
 * الفحص يقتصر على مسار تفاصيل المنصة وحده، ولا يقرأ بياناً ولا يستدعي API ولا يعدّل الصلاحيات.
 * مفتاح معروف يمرّ كما هو، فتبقى بوّابات الصلاحية وحالات الصفحة كلها في الشاشة نفسها.
 * ملاحظة: في Next 16 يُعاد تسمية هذا الملف إلى `proxy.ts`.
 */
export function middleware(request: NextRequest) {
  const raw = request.nextUrl.pathname.split('/').pop() ?? '';
  let key = '';
  try {
    key = decodeURIComponent(raw);
  } catch {
    // ترميز مشوّه = مفتاح غير معروف.
  }
  if (isKnownDeliveryPlatform(key)) return NextResponse.next();

  // يُعاد توجيه الطلب إلى المسار نفسه بعلامة، فتُرسم `not-found.tsx` ضمن هيكل التطبيق ويخرج الرمز 404.
  const target = request.nextUrl.clone();
  target.searchParams.set('unknown_platform', '1');
  return NextResponse.rewrite(target, { status: 404 });
}

export const config = {
  matcher: '/integrations/delivery-platforms/:platformKey',
};
