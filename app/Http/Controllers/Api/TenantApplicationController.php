<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ToggleApplicationRequest;
use App\Services\TenantApplicationService;
use Illuminate\Http\JsonResponse;

/**
 * قرار كل مستأجر بتفعيل/إيقاف قدرة من ApplicationCatalog. لا يفتح هذا المسار
 * تنقلاً ولا صلاحيات جديدة بذاته — ذلك إنفاذ لاحق منفصل عمداً (P2).
 */
class TenantApplicationController extends ApiController
{
    public function __construct(private TenantApplicationService $applications) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->applications->stateFor()]);
    }

    public function enable(ToggleApplicationRequest $request): JsonResponse
    {
        $key = $request->validated('application_key');
        $this->domain(fn () => $this->applications->enable($key, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->stateFor()[$key]]);
    }

    public function disable(ToggleApplicationRequest $request): JsonResponse
    {
        $key = $request->validated('application_key');
        $this->domain(fn () => $this->applications->disable($key, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->stateFor()[$key]]);
    }
}
