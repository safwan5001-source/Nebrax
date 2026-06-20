<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePurchaseRequest;
use App\Http\Resources\PurchaseResource;
use App\Models\Partner;
use App\Models\Purchase;
use App\Services\Accounting\PurchaseService;
use Illuminate\Http\JsonResponse;

class PurchaseController extends ApiController
{
    public function __construct(protected PurchaseService $purchases) {}

    public function index(): JsonResponse
    {
        return PurchaseResource::collection(Purchase::with('lines')->latest()->get())->response();
    }

    public function store(StorePurchaseRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل المورد

        $purchase = $this->domain(fn () => $this->purchases->create($data, $data['items']));

        return (new PurchaseResource($purchase->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new PurchaseResource(Purchase::with('lines')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $purchase = Purchase::findOrFail($id);
        $posted = $this->domain(fn () => $this->purchases->post($purchase));

        return (new PurchaseResource($posted->load('lines')))->response();
    }
}
