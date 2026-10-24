<?php

namespace App\Http\Controllers\Api;

use App\Services\OnlinePaymentMethodSettingsService;
use App\Support\OnlinePaymentMethodCatalog;
use App\Support\PaymentGatewayException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** وسائل الدفع الإلكتروني (PAY-SETTINGS-UX): `GET /online-payment-methods` (`payments.view`) · `PUT /online-payment-methods/{key}` (`payment_gateways.manage`). منفصلة عن `payment-methods` (النقد/البنك/الشيك). */
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
        $data = $request->validate(['enabled' => ['required', 'boolean'], 'reason' => ['nullable', 'string', 'max:500']]);

        try {
            return response()->json(['data' => $this->methods->setEnabled($key, (bool) $data['enabled'], $request->user(), $data['reason'] ?? null)]);
        } catch (PaymentGatewayException $e) {
            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], 422);
        }
    }
}
