<?php

namespace App\Http\Controllers\Api;

use App\Models\Storefront;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public storefront catalog — إعداد المتجر العام الأدنى (COM-7-P2B).
 *
 * يعرض `default_locale` وحده من `Storefront` المحلول ثقةً — لا شيء آخر
 * (لا علامة تجارية ولا قالب ولا SEO، تلك خارج نطاق `Storefront` نفسه أصلاً
 * حسب AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §2). واجهة
 * Next.js تستهلكه لتحديد لغة المتجر الافتراضية دون أن تصبح اللغة سلطة
 * Tenant/Storefront بأي شكل — الحسم يبقى حصراً عبر `StorefrontContext`.
 *
 * `null` على المسار المتوارَث (`ResolveStorefrontTenant`، COM-7-P1) الذي لا
 * يحلّ صفّ `Storefront` أصلاً — الواجهة تسقط حينها على العربية افتراضياً.
 */
class StorefrontConfigController extends PublicApiController
{
    public function show(Request $request): JsonResponse
    {
        $storefront = app(StorefrontContext::class);

        $defaultLocale = $storefront->hasStorefront()
            ? Storefront::query()->whereKey($storefront->storefrontId())->value('default_locale')
            : null;

        return new JsonResponse([
            'data' => [
                'default_locale' => $defaultLocale,
            ],
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }
}
