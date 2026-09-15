<?php

namespace App\Http\Controllers\Api;

use App\Models\Tenant;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Commerce API V1 — store identity/config (PR-1's only endpoint).
 *
 * Mirrors `StorefrontConfigController`'s minimal shape, deliberately not its
 * code: `/commerce/v1` and `/store/v1` are two independent trust boundaries
 * by design (architecture doc §3.1) sharing services, not controllers — so
 * this stays its own thin projection rather than a second consumer of a
 * `/store/v1`-named class.
 *
 * The mobile path never resolves a `Storefront` row (`MobileSalesChannelResolver`
 * — no such row exists for a `type=mobile` channel by design), so unlike
 * `StorefrontConfigController` there is no `default_locale` source to report
 * here yet. Returning a field that would always be `null` would look like
 * unfinished work rather than an honest contract; extend this only when a
 * real mobile-config need (locale, currency, …) is identified — architecture
 * doc §3.2.
 */
class CommerceStorefrontController extends PublicApiController
{
    public function show(Request $request): JsonResponse
    {
        $tenantId = app(StorefrontContext::class)->tenantId();
        $name = Tenant::query()->whereKey($tenantId)->value('name');

        return PublicApiResponse::success($request, ['name' => $name]);
    }
}
