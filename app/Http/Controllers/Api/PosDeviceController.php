<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosDeviceRequest;
use App\Http\Resources\PosDeviceResource;
use App\Models\PosDevice;
use App\Services\Accounting\PosDeviceService;
use Illuminate\Http\JsonResponse;

class PosDeviceController extends ApiController
{
    public function __construct(protected PosDeviceService $devices) {}

    public function index(): JsonResponse
    {
        return PosDeviceResource::collection(PosDevice::with('warehouse')->orderBy('name')->get())->response();
    }

    public function store(StorePosDeviceRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertWarehouseAllowed($data['warehouse_id'], $this->activeBranchId());
        $device = $this->domain(fn () => $this->devices->create($data));

        return (new PosDeviceResource($device->load('warehouse')))->response()->setStatusCode(201);
    }

    public function update(StorePosDeviceRequest $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $data = $request->validated();
        if (array_key_exists('warehouse_id', $data)) {
            $this->assertWarehouseAllowed($data['warehouse_id'], $device->branch_id);
        }

        $device = $this->domain(fn () => $this->devices->update($device, $data));

        return (new PosDeviceResource($device))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $this->domain(fn () => $this->devices->delete($device));

        return response()->json(['message' => 'تم حذف جهاز نقطة البيع.']);
    }
}
