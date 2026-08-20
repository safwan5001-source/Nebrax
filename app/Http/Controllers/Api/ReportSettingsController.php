<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateReportSettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

class ReportSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => Settings::group('reports')]);
    }

    public function update(UpdateReportSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('reports', $request->validated())]);
    }
}
