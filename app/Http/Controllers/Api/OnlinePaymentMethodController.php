<?php

namespace App\Http\Controllers\Api;

use App\Services\OnlinePaymentMethodSettingsService;
use App\Support\OnlinePaymentMethodCatalog;
use App\Support\PaymentGatewayException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** وسائل الدفع الإلكتروني (PAY-SETTINGS-UX): `GET /online-payment-methods` (`payments.view`) · `PUT /online-payment-methods/{key}` (`payment_gateways.manage`: enabled · default_gateway_id · use_in_invoices · use_in_store — أي منها اختياري). منفصلة عن `payment-methods` (النقد/البنك/الشيك). */
class OnlinePaymentMethodController extends ApiController
{
    public function __construct(private readonly OnlinePaymentMethodSettingsService $methods) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->methods->overview()]);
    }

    public function update(Request $request, string $key): JsonResponse
    {
        if (! OnlinePaymentMethodCatalog::isKnown($key)) {
            return response()->json(['error' => ['code' => 'method.unknown', 'message' => 'وسيلة دفع غير معروفة.']], 404);
        }
        $data = $request->validate([
            'enabled' => ['sometimes', 'boolean'],
            'default_gateway_id' => ['sometimes', 'nullable', 'uuid'],
            'use_in_invoices' => ['sometimes', 'boolean'],
            'use_in_store' => ['sometimes', 'boolean'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $changes = array_intersect_key($data, array_flip(['enabled', 'default_gateway_id', 'use_in_invoices', 'use_in_store']));
        if ($changes === []) {
            return response()->json(['error' => ['code' => 'method.nothing_to_update', 'message' => 'لا إعداد للتحديث.']], 422);
        }

        try {
            return response()->json(['data' => $this->methods->updateSettings($key, $changes, $request->user(), $data['reason'] ?? null)]);
        } catch (PaymentGatewayException $e) {
            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], 422);
        }
    }
}
