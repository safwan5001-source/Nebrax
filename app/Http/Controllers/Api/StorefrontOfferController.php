<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontOfferResource;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CUST-H4-6 — العروض العامة (`GET /store/v1/offers`)، قراءة مجهولة فقط.
 *
 * **السلطة من الـ Host وحده**: `ResolveStorefrontDomain` حلّ النطاق الموثَّق
 * فالمتجر النشط فقناة الويب النشطة وضبط `StorefrontContext`. لا يُقرأ هنا أي
 * معرّف متجر/مستأجر/قناة من المسار أو الاستعلام أو الجسم أو الترويسات — وأي
 * `storefront_id` وارد يُتجاهَل كلياً (راجع اختبار الأمان).
 *
 * لا يظهر إلا عرضٌ أثبت مسار التسعير القائم أن له خصماً حقيقياً الآن
 * (`StorefrontOfferResolver`) — وجود صفّ التهيئة وحده لا يكفي. السعر المعروض
 * هو بالبناء ما ستحاسب به السلة؛ لا مسار تسعير عرضٍ ثانٍ قد ينحرف عن الواقع.
 */
class StorefrontOfferController extends PublicApiController
{
    public function index(Request $request, StorefrontOfferResolver $resolver): JsonResponse
    {
        $context = app(StorefrontContext::class);

        $views = $resolver->liveForStorefront($context->storefrontId(), $context->salesChannelId());

        return new JsonResponse([
            'data' => array_map(fn ($view) => StorefrontOfferResource::public($view), $views),
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }
}
