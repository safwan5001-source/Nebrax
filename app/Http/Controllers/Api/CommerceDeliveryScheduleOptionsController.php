<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceDeliverySlot;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * FLOWERS-H7a / ADR-19 — خيارات جدولة التسليم العامة (commerce/v1)، قراءة مجهولة فقط. القناة من السياق
 * الموثوق لا من العميل؛ `city`/`region` يرشّحان العرض فقط (التحقق النهائي عند الإتمام من الوجهة المخزَّنة).
 */
class CommerceDeliveryScheduleOptionsController extends PublicApiController
{
    public function show(Request $request, CommerceDeliveryScheduleService $schedule): JsonResponse
    {
        $query = $request->validate([
            'method' => ['sometimes', Rule::in(CommerceDeliverySlot::METHODS)],
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'region' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $channelId = app(StorefrontContext::class)->salesChannelId();

        return new JsonResponse([
            'data' => $schedule->options(
                $channelId,
                $query['method'] ?? CommerceDeliverySlot::METHOD_DELIVERY,
                $query['city'] ?? null,
                $query['region'] ?? null,
            ),
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }
}
