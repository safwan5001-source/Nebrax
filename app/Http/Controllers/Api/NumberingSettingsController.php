<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateNumberingSettingsRequest;
use App\Support\DocumentNumberingCatalog;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات الترقيم المتسلسل — الموضع الواحد الذي تُعرض منه سلاسل المستندات.
 *
 * **مصدر البيانات هو مصدر الخدمات نفسه:** البادئة تُكتب في المفتاح الذي
 * تقرؤه خدمةُ الكيان أصلاً (`sales.invoice_prefix` · `purchases.purchase_prefix`)،
 * فلا مخزن مواز ولا هجرة. والرقم التالي يُقرأ باستدعاء طبقة الترقيم نفسها.
 *
 * التنسيق وعدد الأرقام والنطاق تُعرَض للاطّلاع: ثوابتُ الطبقة وتصنيفُ النموذج،
 * لا إعدادات. وتغييرها يتطلّب تعديل الطبقة أو تصنيف النموذج — خارج هذه الشاشة.
 */
class NumberingSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json([
            'data' => DocumentNumberingCatalog::describeAll(),
            'meta' => [
                'format'         => DocumentNumberingCatalog::FORMAT,
                'padding'        => DocumentNumberingCatalog::PADDING,
                'editable_keys'  => DocumentNumberingCatalog::editableKeys(),
            ],
        ]);
    }

    public function update(UpdateNumberingSettingsRequest $request): JsonResponse
    {
        $data = $request->validated();

        DocumentNumberingCatalog::putSeriesFormat(
            $data['entity'],
            $data['series_key'],
            $data['prefix'] ?? null,
            $data['suffix'] ?? null,
        );

        return response()->json(['data' => DocumentNumberingCatalog::describe($data['entity'])]);
    }
}
