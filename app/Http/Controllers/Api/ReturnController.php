<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreReturnRequest;
use App\Http\Resources\ReturnResource;
use App\Models\Partner;
use App\Models\ReturnDocument;
use App\Services\Accounting\ReturnService;
use Illuminate\Http\JsonResponse;

class ReturnController extends ApiController
{
    public function __construct(protected ReturnService $returns) {}

    public function index(): JsonResponse
    {
        return ReturnResource::collection(ReturnDocument::with('lines')->latest()->get())->response();
    }

    public function store(StoreReturnRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل الطرف

        $return = $this->domain(fn () => $this->returns->create($data, $data['items']));

        return (new ReturnResource($return->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ReturnResource(ReturnDocument::with('lines')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $return = ReturnDocument::findOrFail($id);
        $posted = $this->domain(fn () => $this->returns->post($return));

        return (new ReturnResource($posted->load('lines')))->response();
    }
}
