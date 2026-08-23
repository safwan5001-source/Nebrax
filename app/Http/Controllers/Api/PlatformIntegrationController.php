<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdatePlatformIntegrationRequest;
use App\Models\PlatformAdministrator;
use App\Services\PlatformIntegrationService;
use Illuminate\Http\JsonResponse;

class PlatformIntegrationController extends ApiController
{
    public function index(PlatformIntegrationService $service): JsonResponse
    {
        return response()->json(['data' => $service->overview()]);
    }

    public function update(
        UpdatePlatformIntegrationRequest $request,
        string $integration,
        PlatformIntegrationService $service,
    ): JsonResponse {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $service->update($administrator, $integration, $request->validated());

        return response()->json(['data' => $service->overview()]);
    }

    public function test(string $integration, PlatformIntegrationService $service): JsonResponse
    {
        return response()->json(['data' => $service->test($integration)]);
    }
}
