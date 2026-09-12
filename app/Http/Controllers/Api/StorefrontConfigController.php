<?php

namespace App\Http\Controllers\Api;

use App\Models\Storefront;
use App\Models\Tenant;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public storefront catalog — إعداد المتجر العام الأدنى (COM-7-P2B + COM-7-P3A).
 *
 * يعرض هوية المتجر الآمنة للعرض العام من السياق المحلول ثقةً:
 * `name` و`default_locale` فقط. لا معرّفات داخلية، لا tenant_id، لا قناة،
 * لا قالب ولا SEO. اسم المتجر يأتي من صفّ `Storefront` المحلول؛ وعلى المسار
 * المتوارَث (P1) الذي لا يحلّ صفّ `Storefront` يُستخدم اسم المستأجر نفسه.
 *
 * واجهة Next.js تستهلك `name` كهوية ظاهرة للمشتري بدل
 * `NEXT_PUBLIC_STORE_NAME` / «Spree Store». اللغة تبقى تفضيلاً للعرض فقط —
 * الحسم يبقى حصراً عبر `StorefrontContext`.
 */
class StorefrontConfigController extends PublicApiController
{
    public function show(Request $request): JsonResponse
    {
        $context = app(StorefrontContext::class);

        $name = null;
        $defaultLocale = null;

        if ($context->hasStorefront()) {
            $row = Storefront::query()
                ->whereKey($context->storefrontId())
                ->first(['name', 'default_locale']);

            $name = $row?->name;
            $defaultLocale = $row?->default_locale;
        } else {
            $name = Tenant::query()
                ->whereKey($context->tenantId())
                ->value('name');
        }

        return new JsonResponse([
            'data' => [
                'name' => $name,
                'default_locale' => $defaultLocale,
            ],
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }
}
