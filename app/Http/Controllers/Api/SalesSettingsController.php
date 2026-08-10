<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateSalesSettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المبيعات (تفضيلات غير محاسبية) — تُخزَّن في `tenants.settings['sales']`.
 *
 * كل مفتاح هنا **يُقرأ فعلاً**: البادئة في ترقيم الفاتورة، والنسبة ونوع السداد
 * كقيم افتراضية عند غياب المُرسَل، ومدّة الصلاحية في عرض السعر. (قبل توصيلها
 * كانت تُحفظ ولا يقرؤها أحد — شاشةٌ تَعِد ولا تفعل.)
 */
class SalesSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => Settings::group('sales')]);
    }

    public function update(UpdateSalesSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('sales', $request->validated())]);
    }
}
