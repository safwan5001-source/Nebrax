<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformAiBudgetRequest;
use App\Models\PlatformAdministrator;
use App\Services\PlatformAiBudgetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** ميزانيات الذكاء الاصطناعي من مساحة المنصة (AI-07): قراءة `platform:read`، كتابة `platform:manage`. */
class PlatformAiBudgetController extends ApiController
{
    public function index(Request $request, PlatformAiBudgetService $service): JsonResponse
    {
        $period = $request->query('period');

        return response()->json(['data' => $service->overview(is_string($period) ? $period : null)]);
    }

    public function update(PlatformAiBudgetRequest $request, PlatformAiBudgetService $service): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return response()->json(['data' => $service->update($administrator, $request->validated())]);
    }
}
