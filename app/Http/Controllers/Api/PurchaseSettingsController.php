<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdatePurchaseSettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المشتريات (تفضيلات غير محاسبية) — تُخزَّن في `tenants.settings['purchases']`.
 *
 * كل مفتاح هنا **يُقرأ فعلاً** في `PurchaseService`/`ProcurementService`:
 * البادئة في الترقيم، ونوع السداد ووضع الضريبة والنسبة كقيم افتراضية عند
 * غياب المُرسَل. لا إعداد يُحفظ ولا يقرؤه أحد.
 */
class PurchaseSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => Settings::group('purchases')]);
    }

    public function update(UpdatePurchaseSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('purchases', $request->validated())]);
    }
}
