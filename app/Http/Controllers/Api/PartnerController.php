<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePartnerRequest;
use App\Http\Resources\PartnerResource;
use App\Models\Partner;
use Illuminate\Http\JsonResponse;

class PartnerController extends ApiController
{
    public function index(): JsonResponse
    {
        return PartnerResource::collection(Partner::latest()->get())->response();
    }

    public function store(StorePartnerRequest $request): JsonResponse
    {
        $partner = Partner::create($request->validated());

        return (new PartnerResource($partner))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PartnerResource(Partner::findOrFail($id)))->response();
    }

    public function update(StorePartnerRequest $request, string $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $partner->update($request->validated());

        return (new PartnerResource($partner))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Partner::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
