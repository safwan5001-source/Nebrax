<?php

namespace App\Http\Controllers\Api;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * مؤشرات تشغيل المنصة المجمّعة.
 *
 * المسارات التابعة له محمية حصراً بـ EnsurePlatformAdministrator ولا تعيد أسماء
 * الشركات أو المستخدمين أو أي تفاصيل تمكّن من تصفح بيانات مستأجر بعينه.
 */
class PlatformDashboardController extends ApiController
{
    public function overview(): JsonResponse
    {
        return response()->json([
            'data' => [
                'tenants' => [
                    'total'    => Tenant::count(),
                    'active'   => Tenant::where('is_active', true)->count(),
                    'inactive' => Tenant::where('is_active', false)->count(),
                ],
                'users' => [
                    'total'    => User::count(),
                    'active'   => User::where('is_active', true)->count(),
                    'inactive' => User::where('is_active', false)->count(),
                ],
            ],
        ]);
    }
}
