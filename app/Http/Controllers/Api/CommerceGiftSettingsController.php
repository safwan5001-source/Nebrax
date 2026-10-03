<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceGiftSetting;
use App\Models\Storefront;
use App\Services\Commerce\CommerceGiftService;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * FLOWERS-H3 / ADR-15 — سياسة الإهداء لقناة متجر ويب. `{id}` محدِّد متجر فقط؛
 * الملكية عبر `TenantContext` (404 غير كاشف). كتابةٌ بـ`commerce.manage`.
 * لا مفتاح قناة/مستأجر من العميل: القناة تُشتقّ من المتجر الموثوق.
 */
final class CommerceGiftSettingsController extends ApiController
{
    public function show(Request $request, CommerceGiftService $gifts, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->ownedStorefront($id);

        return response()->json(['data' => ['gift_settings' => $gifts->optionsForChannel($storefront->sales_channel_id)]]);
    }

    public function update(Request $request, CommerceGiftService $gifts, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'message_max_length' => ['sometimes', 'integer', 'min:1', 'max:'.CommerceGiftSetting::MAX_LENGTH_CEILING],
            'allow_hide_sender' => ['sometimes', 'boolean'],
            'recipient_phone_required' => ['sometimes', 'boolean'],
        ]);
        $storefront = $this->ownedStorefront($id);

        return response()->json(['data' => ['gift_settings' => $gifts->saveSettings($storefront->sales_channel_id, $data)]]);
    }

    private function ownedStorefront(string $id): Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($id);
        abort_if($storefront === null || $storefront->tenant_id !== $tenantId, 404, 'المتجر غير موجود.');

        return $storefront;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
