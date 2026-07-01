<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCostCenterRequest;
use App\Http\Resources\CostCenterResource;
use App\Models\CostCenter;
use Illuminate\Http\JsonResponse;

class CostCenterController extends ApiController
{
    public function index(): JsonResponse
    {
        return CostCenterResource::collection(CostCenter::orderBy('code')->get())->response();
    }

    public function store(StoreCostCenterRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (CostCenter::where('code', $data['code'])->exists()) {
            abort(422, 'كود مركز التكلفة مستخدم مسبقاً.');
        }

        $center = CostCenter::create([
            'code'      => $data['code'],
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new CostCenterResource($center))->response()->setStatusCode(201);
    }

    public function update(StoreCostCenterRequest $request, string $id): JsonResponse
    {
        $center = CostCenter::findOrFail($id);
        $data = $request->validated();
        if (CostCenter::where('code', $data['code'])->where('id', '!=', $id)->exists()) {
            abort(422, 'كود مركز التكلفة مستخدم مسبقاً.');
        }

        $center->update([
            'code'      => $data['code'],
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? $center->is_active,
        ]);

        return (new CostCenterResource($center))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        CostCenter::findOrFail($id)->delete();

        return response()->json(['message' => 'deleted']);
    }
}
