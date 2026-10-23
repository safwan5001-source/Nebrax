<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AiActionTenantSettingsRequest;
use App\Models\Tenant;
use App\Services\AiActionTenantEnablementService;
use App\Support\AiActionException;
use App\Support\Rbac;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** قبول المؤسسة لـAI Actions (IMP-H2-S4). الكتابة بصلاحية `ai.actions.manage`؛ والقراءة لمن يملك أيّاً من صلاحيات AI Actions. */
class AiActionSettingsController extends ApiController
{
    private const READ = ['ai.actions.use', 'ai.actions.approve', 'ai.actions.repair', 'ai.actions.manage'];

    public function show(Request $request, AiActionTenantEnablementService $enablement): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            collect(self::READ)->contains(fn (string $permission) => Rbac::allows((string) $user->role, $permission)),
            403,
            'ليس لديك صلاحية لهذا الإجراء.',
        );

        return response()->json(['data' => $enablement->status(Tenant::query()->findOrFail($user->tenant_id))]);
    }

    public function update(AiActionTenantSettingsRequest $request, AiActionTenantEnablementService $enablement): JsonResponse
    {
        try {
            $data = $enablement->update($request->user(), $request->boolean('enabled'));
        } catch (AiActionException $exception) {
            return response()->json(['error' => ['code' => $exception->reason, 'message' => $exception->getMessage()]], $exception->status);
        }

        return response()->json(['data' => $data]);
    }
}
