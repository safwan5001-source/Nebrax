<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformGlobalApplicationOverrideApplyRequest;
use App\Http\Requests\PlatformGlobalApplicationOverridePreviewRequest;
use App\Http\Requests\PlatformGlobalApplicationOverrideSummaryRequest;
use App\Models\PlatformAdministrator;
use App\Services\PlatformGlobalApplicationOverrideService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class PlatformGlobalApplicationOverrideController extends ApiController
{
    public function __construct(private PlatformGlobalApplicationOverrideService $globalOverrides) {}

    public function summary(PlatformGlobalApplicationOverrideSummaryRequest $request): JsonResponse
    {
        $tenantIds = $request->validated()['tenant_ids'] ?? null;

        return response()->json([
            'data' => $this->globalOverrides->summary(
                is_array($tenantIds) && $tenantIds !== [] ? $tenantIds : null,
            ),
        ]);
    }

    public function preview(PlatformGlobalApplicationOverridePreviewRequest $request): JsonResponse
    {
        $data = $request->validated();

        try {
            $preview = $this->globalOverrides->preview(
                $this->administrator($request),
                $data['operation'],
                $data['application_key'] ?? null,
                $data['tenant_ids'] ?? null,
            );
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $preview]);
    }

    public function apply(PlatformGlobalApplicationOverrideApplyRequest $request): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $this->globalOverrides->apply(
                $this->administrator($request),
                $data['confirmation_token'],
                $data['operation'],
                $data['application_key'] ?? null,
                $data['tenant_ids'] ?? null,
                $data['reason'] ?? null,
            );
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    private function administrator(Request $request): PlatformAdministrator
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return $administrator;
    }
}
