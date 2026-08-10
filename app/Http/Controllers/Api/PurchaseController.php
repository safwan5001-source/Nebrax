<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePurchaseRequest;
use App\Http\Resources\PurchaseResource;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Services\Accounting\PurchaseService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseController extends ApiController
{
    public function __construct(protected PurchaseService $purchases) {}

    public function index(Request $request): JsonResponse
    {
        return PurchaseResource::collection($this->scopeToActiveBranch(Purchase::with('lines')->latest(), $request)->get())->response();
    }

    public function store(StorePurchaseRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل المورد
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

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
