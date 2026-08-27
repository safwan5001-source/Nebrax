<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateZatcaCredentialRequest;
use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaCredentialService;
use Illuminate\Http\JsonResponse;

class ZatcaCredentialController extends ApiController
{
    public function index(ZatcaCredentialService $service): JsonResponse
    {
        $data = ZatcaCredential::orderBy('environment')->get()
            ->map(fn (ZatcaCredential $credential) => $service->publicMetadata($credential))
            ->values();

        return response()->json(['data' => $data]);
    }

    public function update(
        UpdateZatcaCredentialRequest $request,
        string $environment,
        ZatcaCredentialService $service,
    ): JsonResponse {
        $credential = $service->store($request->user(), $environment, $request->validated());

        return response()->json(['data' => $service->publicMetadata($credential)]);
    }
}
