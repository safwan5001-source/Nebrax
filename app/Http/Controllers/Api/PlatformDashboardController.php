<?php

namespace App\Http\Controllers\Api;

use App\Support\PlatformMetrics;
use Illuminate\Http\JsonResponse;

/**
 * مؤشرات تشغيل المنصة المجمّعة.
 *
 * المسارات التابعة له محمية حصراً بـ EnsurePlatformAdministrator ولا تعيد أسماء
 * الشركات أو المستخدمين أو أي تفاصيل تمكّن من تصفح بيانات مستأجر بعينه.
 */
class PlatformDashboardController extends ApiController
{
    public function overview(PlatformMetrics $metrics): JsonResponse
    {
        return response()->json(['data' => $metrics->overview()]);
    }
}
