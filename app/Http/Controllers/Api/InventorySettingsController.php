<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateInventorySettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المخزون — سياسة تشغيلية بأثر محاسبي غير مباشر.
 *
 * `allow_negative_stock` **يُقرأ فعلاً** في `InventoryService::assertStockAvailable`
 * على مسارَي البيع وإرجاع المشتريات. لا إعداد يُحفظ ولا يقرؤه أحد.
 */
class InventorySettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => Settings::group('inventory')]);
    }

    public function update(UpdateInventorySettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('inventory', $request->validated())]);
    }
}
