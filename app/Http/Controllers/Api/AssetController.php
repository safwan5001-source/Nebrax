<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAssetRequest;
use App\Http\Resources\AssetResource;
use App\Models\Asset;
use App\Models\Partner;
use App\Services\Accounting\AssetService;
use Illuminate\Http\JsonResponse;

class AssetController extends ApiController
{
    public function __construct(protected AssetService $assets) {}

    public function index(): JsonResponse
    {
        return AssetResource::collection(Asset::with('account')->latest()->get())->response();
    }

    public function store(StoreAssetRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']); // عزل: المورّد يخص المستأجر
        }

        $asset = $this->domain(fn () => $this->assets->create($data));

        return (new AssetResource($asset->load('account')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new AssetResource(Asset::with('account')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $asset = Asset::findOrFail($id);
        $posted = $this->domain(fn () => $this->assets->post($asset));

        return (new AssetResource($posted->load('account')))->response();
    }

    public function depreciate(string $id): JsonResponse
    {
        $asset = Asset::findOrFail($id);
        $result = $this->domain(fn () => $this->assets->depreciate($asset));

        return (new AssetResource($result->load('account')))->response();
    }
}
