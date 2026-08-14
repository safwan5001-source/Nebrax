<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateZatcaSettingsRequest;
use App\Support\Settings;
use App\Support\ZatcaIcvScope;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات الفوترة الإلكترونية — تُخزَّن في `tenants.settings['zatca']`.
 *
 * مفتاحٌ واحد اليوم: نطاق عدّاد ICV. و`ZatcaService` **يقرؤه فعلاً** عبر
 * `ZatcaIcvScope` عند كل ترحيل — لا إعداد يُحفظ ولا يقرؤه أحد.
 *
 * **لا علاقة لهذه الشاشة ببادئات ترقيم المستندات.** تلك في إعدادات المبيعات
 * والمشتريات، وتلك سلاسلٌ أخرى بقواعد أخرى.
 */
class ZatcaSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json([
            'data' => Settings::group('zatca'),
            // تُرسَل للواجهة لتُعطِّل الخيار وتشرح سببه — بدل أن تعرضه قابلاً
            // للاختيار ثم يفشل الحفظ.
            'meta' => [
                'effective_icv_scope'   => ZatcaIcvScope::current(),
                'branch_scope_available' => ZatcaIcvScope::branchAvailable(),
                'branch_scope_blocker'   => ZatcaIcvScope::unavailableReason(),
            ],
        ]);
    }

    public function update(UpdateZatcaSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('zatca', $request->validated())]);
    }
}
