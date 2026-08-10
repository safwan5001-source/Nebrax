<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreReturnRequest;
use App\Http\Resources\ReturnResource;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Services\Accounting\ReturnService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReturnController extends ApiController
{
    public function __construct(protected ReturnService $returns) {}

    /**
     * قائمة المرتجعات، مع تصفية اختيارية بالنوع (`?type=sales|purchase`).
     * بلا نوع تُعاد كلها — توافق رجعي كامل.
     */
    public function index(Request $request): JsonResponse
    {
        $type = $request->query('type');

        $query = ReturnDocument::with('lines')->latest();
        if (in_array($type, ['sales', 'purchase'], true)) {
            $query->where('type', $type);
        }

        return ReturnResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreReturnRequest $request): JsonResponse
    {
        $data = $request->validated();

        Partner::findOrFail($data['partner_id']); // عزل الطرف
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

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
