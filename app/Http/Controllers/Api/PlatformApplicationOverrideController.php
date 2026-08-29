<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformApplicationOverrideBulkRequest;
use App\Http\Requests\PlatformApplicationOverridePreviewRequest;
use App\Http\Requests\PlatformApplicationOverrideRequest;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\PlatformApplicationOverrideService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlatformApplicationOverrideController extends ApiController
{
    public function __construct(private PlatformApplicationOverrideService $overrides) {}

    public function summary(Tenant $tenant): JsonResponse
    {
        return response()->json(['data' => $this->overrides->summary($tenant)]);
    }

    public function preview(PlatformApplicationOverridePreviewRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        if (isset($data['action']) && in_array($data['action'], [
            PlatformApplicationOverrideService::BULK_GRANT_ALL,
            PlatformApplicationOverrideService::BULK_REVERT_ALL,
            PlatformApplicationOverrideService::BULK_SHOW_ALL,
            PlatformApplicationOverrideService::BULK_HIDE_ALL,
        ], true)) {
            return response()->json([
                'data' => $this->overrides->previewBulk($tenant, $data['action'], $data['keys'] ?? null),
            ]);
        }

        $key = $data['application_key'] ?? null;
        $action = $data['action'] ?? 'grant';

        if ($key === null) {
            return response()->json(['message' => 'application_key is required for single preview.'], 422);
        }

        $preview = match ($action) {
            'grant' => $this->overrides->previewGrant($tenant, $key),
            'revert' => $this->overrides->previewRevert($tenant, $key),
            'show' => $this->overrides->previewShow($tenant, $key),
            'hide' => $this->overrides->previewHide($tenant, $key),
            default => $this->overrides->previewGrant($tenant, $key),
        };

        return response()->json(['data' => $preview]);
    }

    public function grant(PlatformApplicationOverrideRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $this->overrides->grant(
                $tenant,
                $this->administrator($request),
                $data['application_key'],
                $data['reason'] ?? null,
            );
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function revert(PlatformApplicationOverrideRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $this->overrides->revert(
                $tenant,
                $this->administrator($request),
                $data['application_key'],
                $data['reason'] ?? null,
            );
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function show(PlatformApplicationOverrideRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $this->overrides->show(
                $tenant,
                $this->administrator($request),
                $data['application_key'],
                $data['reason'] ?? null,
            );
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function hide(PlatformApplicationOverrideRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $this->overrides->hide(
                $tenant,
                $this->administrator($request),
                $data['application_key'],
                $data['reason'] ?? null,
            );
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function bulk(PlatformApplicationOverrideBulkRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();

        return response()->json([
            'data' => $this->overrides->applyBulk(
                $tenant,
                $this->administrator($request),
                $data['action'],
                $data['keys'] ?? null,
                $data['reason'] ?? null,
            ),
        ]);
    }

    private function administrator(Request $request): PlatformAdministrator
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return $administrator;
    }
}
