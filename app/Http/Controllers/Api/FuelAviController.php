<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelAviAuthorizationRequest;
use App\Http\Requests\StoreFuelAviIdentityTagRequest;
use App\Http\Requests\UpdateFuelAviIdentityTagRequest;
use App\Http\Resources\FuelAviAuthorizationResource;
use App\Http\Resources\FuelAviIdentityTagResource;
use App\Models\FuelAviAuthorization;
use App\Models\FuelAviIdentityTag;
use App\Services\FuelAviAuthorizationService;
use App\Services\FuelAviIdentityTagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FuelAviController extends ApiController
{
    public function __construct(
        private FuelAviIdentityTagService $tags,
        private FuelAviAuthorizationService $authorizations,
    ) {}

    public function indexTags(Request $request): JsonResponse
    {
        $query = FuelAviIdentityTag::query()->with('partner')->orderByDesc('created_at');
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('identity_type')) {
            $query->where('identity_type', $request->query('identity_type'));
        }
        if ($request->filled('partner_id')) {
            $query->where('partner_id', $request->query('partner_id'));
        }

        return FuelAviIdentityTagResource::collection($query->paginate(50))->response();
    }

    public function storeTag(StoreFuelAviIdentityTagRequest $request): JsonResponse
    {
        $tag = $this->domain(fn () => $this->tags->create($request->validated(), $request->user()));

        return (new FuelAviIdentityTagResource($tag))->response()->setStatusCode(201);
    }

    public function updateTag(UpdateFuelAviIdentityTagRequest $request, string $id): JsonResponse
    {
        $tag = FuelAviIdentityTag::findOrFail($id);
        $updated = $this->domain(fn () => $this->tags->update($tag, $request->validated(), $request->user()));

        return (new FuelAviIdentityTagResource($updated))->response();
    }

    public function replaceTag(StoreFuelAviIdentityTagRequest $request, string $id): JsonResponse
    {
        $tag = FuelAviIdentityTag::findOrFail($id);
        $replacement = $this->domain(fn () => $this->tags->replace($tag, $request->validated(), $request->user()));

        return (new FuelAviIdentityTagResource($replacement))->response()->setStatusCode(201);
    }

    public function indexAuthorizations(Request $request): JsonResponse
    {
        $query = FuelAviAuthorization::query()->orderByDesc('authorized_at');
        foreach (['fuel_station_id', 'decision', 'fuel_fleet_vehicle_id', 'partner_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }

        return FuelAviAuthorizationResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function authorize(StoreFuelAviAuthorizationRequest $request): JsonResponse
    {
        $authorization = $this->domain(fn () => $this->authorizations->authorize($request->validated(), $request->user()));

        return (new FuelAviAuthorizationResource($authorization))->response()->setStatusCode(201);
    }
}
