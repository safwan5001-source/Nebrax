<?php

namespace App\Http\Controllers\Api;

use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\StorefrontPresentationService;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public storefront catalog — إعداد المتجر العام الأدنى (COM-7-P2B + COM-7-P3A).
 *
 * يعرض هوية المتجر الآمنة للعرض العام من السياق المحلول ثقةً:
 * `name` و`default_locale` و`presentation` (لقطة منشورة أو null).
 * لا معرّفات داخلية، لا tenant_id، لا قناة، لا مسودة. اسم المتجر يأتي من صفّ
 * `Storefront` المحلول؛ وعلى المسار المتوارَث (P1) الذي لا يحلّ صفّ
 * `Storefront` يُستخدم اسم المستأجر نفسه.
 *
 * واجهة Next.js تستهلك `name` كهوية ظاهرة للمشتري بدل
 * `NEXT_PUBLIC_STORE_NAME` / «Spree Store». اللغة تبقى تفضيلاً للعرض فقط —
 * الحسم يبقى حصراً عبر `StorefrontContext`.
 */
class StorefrontConfigController extends PublicApiController
{
    public function show(Request $request, StorefrontPresentationService $presentations): JsonResponse
    {
        $context = app(StorefrontContext::class);

        $name = null;
        $defaultLocale = null;
        $presentation = null;
        $businessIdentity = [
            'legal_name' => null,
            'cr_number' => null,
            'vat_number' => null,
        ];

        if ($context->hasStorefront()) {
            $row = Storefront::query()
                ->whereKey($context->storefrontId())
                ->where('tenant_id', $context->tenantId())
                ->first(['name', 'default_locale', 'tenant_id']);

            $name = $row?->name;
            $defaultLocale = $row?->default_locale;
            $presentation = $presentations->publishedSnapshotForStorefront($context->storefrontId());

            $tenant = $row
                ? Tenant::query()->find($row->tenant_id, ['name', 'cr_number', 'vat_number'])
                : null;
        } else {
            $tenant = Tenant::query()->find($context->tenantId(), ['name', 'cr_number', 'vat_number']);
            $name = $tenant?->name;
        }

        if (isset($tenant)) {
            $businessIdentity = [
                'legal_name' => $this->nullableIdentityValue($tenant->name),
                'cr_number' => $this->nullableIdentityValue($tenant->cr_number),
                'vat_number' => $this->nullableIdentityValue($tenant->vat_number),
            ];
        }

        return new JsonResponse([
            'data' => [
                'name' => $name,
                'default_locale' => $defaultLocale,
                'business_identity' => $businessIdentity,
                'presentation' => $presentation,
            ],
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }

    private function nullableIdentityValue(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
