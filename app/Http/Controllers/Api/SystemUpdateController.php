<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\SystemUpdateResource;
use App\Models\SystemUpdate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تحديثات النظام المنشورة — عرض المستأجر (PR-NOTIF-6).
 *
 * يعرض فقط التحديثات المنشورة المستهدفة لهذا المستأجر أو المستخدم.
 * بلا RBAC (مثل صندوق الإشعارات — بيانات عامة من المنصة لكل مستخدم).
 * متاح حتى مع اشتراك منتهٍ.
 */
class SystemUpdateController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenantId = $user->tenant_id;

        $updates = SystemUpdate::query()
            ->where('status', SystemUpdate::STATUS_PUBLISHED)
            ->where(function ($query) use ($tenantId, $user) {
                $query->where('target_type', SystemUpdate::TARGET_ALL)
                    ->orWhere(function ($q) use ($tenantId) {
                        $q->where('target_type', SystemUpdate::TARGET_TENANTS)
                            ->whereHas('targets', fn ($t) => $t->where('target_type', 'tenant')
                                ->where('target_id', $tenantId));
                    })
                    ->orWhere(function ($q) use ($user) {
                        $q->where('target_type', SystemUpdate::TARGET_USERS)
                            ->whereHas('targets', fn ($t) => $t->where('target_type', 'user')
                                ->where('target_id', $user->id));
                    });
            })
            ->orderByDesc('published_at')
            ->paginate(20);

        return SystemUpdateResource::collection($updates)->response();
    }
}
