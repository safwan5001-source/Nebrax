<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosShiftRequest;
use App\Http\Resources\PosShiftResource;
use App\Models\PosShift;
use Illuminate\Http\JsonResponse;

class PosShiftController extends ApiController
{
    public function index(): JsonResponse
    {
        return PosShiftResource::collection(PosShift::orderBy('name')->get())->response();
    }

    public function store(StorePosShiftRequest $request): JsonResponse
    {
        $shift = PosShift::create($request->validated());

        return (new PosShiftResource($shift))->response()->setStatusCode(201);
    }

    public function update(StorePosShiftRequest $request, string $id): JsonResponse
    {
        $shift = PosShift::findOrFail($id);
        $shift->update($request->validated());

        return (new PosShiftResource($shift))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $shift = PosShift::findOrFail($id);
        if ($shift->sessions()->exists()) {
            return response()->json([
                'message' => 'لا يمكن حذف وردية نقاط بيع مرتبطة بجلسات. عطّلها بدلاً من ذلك.',
            ], 422);
        }

        $shift->delete();

        return response()->json(['message' => 'تم حذف وردية نقاط البيع.']);
    }
}
