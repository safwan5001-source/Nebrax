<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreRequestTypeRequest;
use App\Http\Resources\RequestTypeResource;
use App\Models\RequestType;
use Illuminate\Http\JsonResponse;

/**
 * أنواع الطلبات — كيانٌ مُدار لكل مؤسسة، بلا أثرٍ محاسبي مباشر.
 */
class RequestTypeController extends ApiController
{
    public function index(): JsonResponse
    {
        return RequestTypeResource::collection(
            RequestType::withCount('employeeRequests')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreRequestTypeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $requestType = RequestType::create($data);

        return (new RequestTypeResource($requestType))->response()->setStatusCode(201);
    }

    public function update(StoreRequestTypeRequest $request, string $id): JsonResponse
    {
        $requestType = RequestType::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $requestType->id);

        $requestType->update($data);

        return (new RequestTypeResource($requestType))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $requestType = RequestType::withCount('employeeRequests')->findOrFail($id);

        if ($requestType->employee_requests_count > 0) {
            abort(422, "لا يمكن حذف نوع الطلب: مرتبطٌ بـ {$requestType->employee_requests_count} طلباً.");
        }

        $requestType->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = RequestType::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد نوع طلب بهذا الاسم.');
        }
    }
}
