<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCommerceShippingZoneRequest;
use App\Models\CommerceShippingZone;
use Illuminate\Http\JsonResponse;

/**
 * COM-MOBILE-SHIPPING-1 (ADR-10) — إدارة مناطق الشحن المُهيَّأة من التاجر.
 * إدارية داخلية بحتة (لا `/commerce/v1`/`/store/v1`) — القراءة العامة عبر
 * `ShippingRateService::resolveRateMinor()` وحده، لا هذا المتحكّم. صلاحية
 * `commerce.manage` نفسها المستعملة لبنية Commerce التحتية الأخرى
 * (`CommerceWorkspaceStorefrontsController`) — لا نطاق `shipping.*` جديد.
 *
 * لا مرجع FK لمنطقةٍ من أي Checkout/Order — الرسم يُحسَم ويُحفَظ لقطةً وقت
 * الحسم (`CommerceCheckout.delivery_amount_minor`)، فالحذف آمنٌ دوماً بلا
 * فحص استخدام (بخلاف `PaymentMethodController::destroy()`).
 */
class CommerceShippingZoneController extends ApiController
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => CommerceShippingZone::query()
                ->orderBy('match_type')
                ->orderBy('name')
                ->get()
                ->map(fn (CommerceShippingZone $zone) => $this->serialize($zone))
                ->all(),
        ]);
    }

    public function store(StoreCommerceShippingZoneRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertMatchValueFree($data['match_type'], $data['match_value']);

        $zone = CommerceShippingZone::create($data);

        return response()->json(['data' => $this->serialize($zone)], 201);
    }

    public function update(StoreCommerceShippingZoneRequest $request, string $id): JsonResponse
    {
        $zone = CommerceShippingZone::findOrFail($id);
        $data = $request->validated();
        $this->assertMatchValueFree($data['match_type'], $data['match_value'], $zone->id);

        $zone->update($data);

        return response()->json(['data' => $this->serialize($zone->fresh())]);
    }

    public function destroy(string $id): JsonResponse
    {
        $zone = CommerceShippingZone::findOrFail($id);
        $zone->delete();

        return response()->json(['message' => 'deleted']);
    }

    private function assertMatchValueFree(string $matchType, string $matchValue, ?string $exceptId = null): void
    {
        $query = CommerceShippingZone::query()
            ->where('match_type', $matchType)
            ->whereRaw('LOWER(match_value) = LOWER(?)', [trim($matchValue)]);
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            abort(422, 'توجد منطقة شحن أخرى بنفس نوع ونصّ المطابقة.');
        }
    }

    /** @return array<string, mixed> */
    private function serialize(CommerceShippingZone $zone): array
    {
        return [
            'id' => $zone->id,
            'name' => $zone->name,
            'match_type' => $zone->match_type,
            'match_value' => $zone->match_value,
            'rate_amount_minor' => $zone->rate_amount_minor,
            'is_active' => $zone->is_active,
            'created_at' => $zone->created_at?->toIso8601String(),
        ];
    }
}
