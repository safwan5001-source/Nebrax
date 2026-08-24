<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdatePlatformIntegrationRequest;
use App\Models\PlatformAdministrator;
use App\Services\PlatformIntegrationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

    public function test(Request $request, string $integration, PlatformIntegrationService $service): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return response()->json(['data' => $service->test($administrator, $integration, $request->string('provider')->toString() ?: null)]);
    }
}
