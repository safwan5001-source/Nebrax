<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\SystemUpdateResource;
use App\Models\SystemUpdate;
use App\Models\SystemUpdateTarget;
use App\Models\Tenant;
use App\Models\User;
use App\Services\SystemUpdatePublicationService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * تحديثات النظام / What's New — مسارات منصة التشغيل الداخلية (PR-NOTIF-6).
 *
 * المسارات محمية بـ `EnsurePlatformAdministrator:platform:manage`.
 * لا تمرّ عبر `SetTenant` ولا تملك `TenantContext`.
 */
class PlatformSystemUpdateController extends ApiController
{
    public function index(): JsonResponse
    {
        $updates = SystemUpdate::query()
            ->with('targets')
            ->orderByDesc('created_at')
            ->paginate(20);

        return SystemUpdateResource::collection($updates)->response();
    }

    public function show(string $id): JsonResponse
    {
        $update = SystemUpdate::with('targets')->findOrFail($id);

        return response()->json(['data' => new SystemUpdateResource($update)]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title_ar' => ['required', 'string', 'max:255'],
            'title_en' => ['required', 'string', 'max:255'],
            'content_ar' => ['required', 'string'],
            'content_en' => ['required', 'string'],
            'target_type' => ['required', 'in:all,tenants,users'],
            'target_ids' => ['array'],
            'target_ids.*' => ['uuid'],
        ]);

        $this->validateTargets($validated);

        $update = SystemUpdate::create([
            'author_id' => $request->user()->id,
            'status' => SystemUpdate::STATUS_DRAFT,
            'target_type' => $validated['target_type'],
            'title_ar' => $validated['title_ar'],
            'title_en' => $validated['title_en'],
            'content_ar' => $validated['content_ar'],
            'content_en' => $validated['content_en'],
        ]);

        $this->syncTargets($update, $validated);

        return response()->json(
            ['data' => new SystemUpdateResource($update->load('targets'))],
            201,
        );
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $update = SystemUpdate::findOrFail($id);

        if ($update->isPublished()) {
            return response()->json(['message' => 'لا يمكن تعديل تحديث منشور.'], 422);
        }

        $validated = $request->validate([
            'title_ar' => ['sometimes', 'string', 'max:255'],
            'title_en' => ['sometimes', 'string', 'max:255'],
            'content_ar' => ['sometimes', 'string'],
            'content_en' => ['sometimes', 'string'],
            'target_type' => ['sometimes', 'in:all,tenants,users'],
            'target_ids' => ['array'],
            'target_ids.*' => ['uuid'],
        ]);

        if (isset($validated['target_type'])) {
            $this->validateTargets($validated);
        }

        $update->update(collect($validated)->only([
            'title_ar', 'title_en', 'content_ar', 'content_en', 'target_type',
        ])->all());

        if (isset($validated['target_type'])) {
            $this->syncTargets($update, $validated);
        }

        return response()->json(['data' => new SystemUpdateResource($update->load('targets'))]);
    }

    public function publish(string $id, SystemUpdatePublicationService $service): JsonResponse
    {
        $update = SystemUpdate::findOrFail($id);
        $update = $service->publish($update);

        return response()->json(['data' => new SystemUpdateResource($update->load('targets'))]);
    }

    public function destroy(string $id): JsonResponse
    {
        $update = SystemUpdate::findOrFail($id);

        if ($update->isPublished()) {
            return response()->json(['message' => 'لا يمكن حذف تحديث منشور.'], 422);
        }

        $update->delete();

        return response()->json(null, 204);
    }

    private function validateTargets(array $validated): void
    {
        $targetType = $validated['target_type'];
        $targetIds = $validated['target_ids'] ?? [];

        if ($targetType !== 'all' && empty($targetIds)) {
            abort(422, 'يجب تحديد مستهدفين عند اختيار استهداف محدد.');
        }

        if ($targetType === 'tenants') {
            $this->assertIdsExist(Tenant::query(), $targetIds, 'يحتوي الاستهداف على معرّف مستأجر غير موجود.');
        }

        if ($targetType === 'users') {
            // `whereHas('tenant')` يستبعد أي مستخدم مرتبط بمستأجر محذوف (soft-deleted)
            // — «مرتبط بمستأجر صالح» لا يكفي فيها وجود tenant_id فقط.
            $this->assertIdsExist(User::query()->whereHas('tenant'), $targetIds, 'يحتوي الاستهداف على معرّف مستخدم غير موجود أو غير مرتبط بمستأجر صالح.');
        }
    }

    private function assertIdsExist(Builder $query, array $ids, string $message): void
    {
        $uniqueIds = array_unique($ids);
        $existingCount = $query->whereIn('id', $uniqueIds)->count();

        if ($existingCount !== count($uniqueIds)) {
            abort(422, $message);
        }
    }

    private function syncTargets(SystemUpdate $update, array $validated): void
    {
        $update->targets()->delete();

        $targetType = $validated['target_type'];
        $targetIds = $validated['target_ids'] ?? [];

        if ($targetType === 'all') {
            return;
        }

        $targetEntityType = $targetType === 'tenants' ? 'tenant' : 'user';

        foreach ($targetIds as $targetId) {
            SystemUpdateTarget::create([
                'system_update_id' => $update->id,
                'target_type' => $targetEntityType,
                'target_id' => $targetId,
            ]);
        }
    }
}
