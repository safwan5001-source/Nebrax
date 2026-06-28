<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCrmActivityRequest;
use App\Http\Resources\CrmActivityResource;
use App\Models\CrmActivity;
use App\Models\Partner;
use Illuminate\Http\JsonResponse;

class CrmActivityController extends ApiController
{
    public function index(): JsonResponse
    {
        return CrmActivityResource::collection(
            CrmActivity::orderByDesc('activity_at')->get()
        )->response();
    }

    public function store(StoreCrmActivityRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر
        }

        $activity = CrmActivity::create($data);

        return (new CrmActivityResource($activity))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new CrmActivityResource(CrmActivity::findOrFail($id)))->response();
    }

    public function update(StoreCrmActivityRequest $request, string $id): JsonResponse
    {
        $activity = CrmActivity::findOrFail($id);
        $activity->update($request->validated());

        return (new CrmActivityResource($activity))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        CrmActivity::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
