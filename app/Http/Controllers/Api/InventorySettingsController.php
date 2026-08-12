<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateInventorySettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المخزون والمنتجات — مورد مفرد (singleton) لكل مستأجر: لا فهرس ولا
 * معرّف في المسار، فالسجلّ واحد بطبيعته.
 *
 * كل مفتاح هنا **يقرؤه شيء فعلاً**: `allow_negative_stock` في
 * `InventoryService::assertStockAvailable` على مسارَي البيع وإرجاع المشتريات،
 * و`show_stock_quantities` في شاشات المنتجات. لا إعداد يُحفظ ولا يقرؤه أحد.
 *
 * `detailed_tracking_enabled` يُقرأ ولا يُكتب — انظر `Settings::DEFAULTS`.
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
