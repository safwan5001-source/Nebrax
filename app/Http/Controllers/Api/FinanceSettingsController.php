<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateFinanceSettingsRequest;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

class FinanceSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => Settings::group('finance')]);
    }

    public function update(UpdateFinanceSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => Settings::put('finance', $request->validated())]);
    }
}
