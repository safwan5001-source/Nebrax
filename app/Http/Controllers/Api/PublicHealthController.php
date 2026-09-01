<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * فحص صحّة الـ Public API (v1) — بلا مصادقة وبلا مستأجر وبلا قاعدة بيانات.
 *
 * يثبت أن أساس الـ Public API حيّ ويستجيب بالعقد الموحّد. الاستجابة ثابتة
 * وصغيرة عمدًا: لا تكشف بيانات مستأجر ولا اعتمادات قاعدة بيانات ولا أسرار بيئة
 * ولا حالة/اعتمادات ZATCA ولا إعدادات داخلية ولا stack traces.
 *
 * ملاحظة معمارية: الملف مسطّح داخل `Api/` (لا مجلد فرعي `Api/Public/`) لأن
 * سكربتات التجميع تنسخ متحكّمات الـ API عبر glob مسطّح؛ مجلد فرعي كان سيتطلّب
 * تعديل قائمة النسخ وحارس CI. البادئة `Public` تحفظ الفصل المنطقي.
 */
class PublicHealthController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        return PublicApiResponse::success($request, [
            'status'  => 'ok',
            'service' => 'awj-public-api',
            'version' => 'v1',
        ]);
    }
}
