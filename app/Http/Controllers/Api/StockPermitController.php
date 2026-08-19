<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreStockPermitRequest;
use App\Http\Resources\StockPermitResource;
use App\Models\Product;
use App\Models\StockPermit;
use App\Models\Warehouse;
use App\Services\Accounting\StockPermitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * الأذون المخزنية — إضافة · صرف · تحويل.
 * الترحيل يحرّك المخزون ويولّد القيد في معاملة واحدة (عبر المحرك حصراً).
 */
class StockPermitController extends ApiController
{
    public function __construct(protected StockPermitService $permits) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'type'   => ['nullable', 'in:receipt,issue,transfer'],
            'status' => ['nullable', 'in:draft,posted'],
        ]);

        $query = StockPermit::with(['lines.product', 'warehouse', 'targetWarehouse'])->latest();

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        return StockPermitResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreStockPermitRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Warehouse::class, $data['warehouse_id'], 'المخزن');
        $this->assertTenantOwned(Warehouse::class, $data['target_warehouse_id'] ?? null, 'مخزن الوجهة');
        // ونطاق المستخدم يشمل طرفَي التحويل معاً — وإلا نقل بضاعةً إلى حيث لا يملك.
        $this->assertWarehouseAllowed($data['warehouse_id']);
        $this->assertWarehouseAllowed($data['target_warehouse_id'] ?? null);
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $permit = $this->domain(fn () => $this->permits->create($data, $data['items']));

        return (new StockPermitResource($permit->load(['lines.product', 'warehouse', 'targetWarehouse'])))
            ->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        $permit = StockPermit::with(['lines.product', 'warehouse', 'targetWarehouse'])->findOrFail($id);

        return (new StockPermitResource($permit))->response();
    }

    public function post(string $id): JsonResponse
    {
        $permit = StockPermit::findOrFail($id);
        $posted = $this->domain(fn () => $this->permits->post($permit));

        return (new StockPermitResource($posted->load(['lines.product', 'warehouse', 'targetWarehouse'])))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $permit = StockPermit::findOrFail($id);

        if (! $permit->isDraft()) {
            abort(422, 'لا يمكن حذف إذن مرحّل — صحّحه بإذن عكسي.');
        }
        $permit->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
