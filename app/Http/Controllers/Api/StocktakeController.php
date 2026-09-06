<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreStocktakeRequest;
use App\Http\Resources\StocktakeResource;
use App\Models\Product;
use App\Models\Stocktake;
use App\Models\Warehouse;
use App\Services\Accounting\StocktakeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * الجرد — فتحٌ يلتقط الأرصدة، ثم عدّ، ثم ترحيلٌ يصحّح الكمية ويولّد قيد الفرق.
 */
class StocktakeController extends ApiController
{
    public function __construct(protected StocktakeService $stocktakes) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['nullable', 'in:draft,posted']]);

        $query = Stocktake::with('warehouse')->latest();
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $query = $this->scopeToActiveBranch($query, $request);
        $query = $this->scopeToAccessibleWarehouses($query, ['warehouse_id']);

        return StocktakeResource::collection($query->get())->response();
    }

    public function store(StoreStocktakeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Warehouse::class, $data['warehouse_id'], 'المخزن');
        $this->assertWarehouseAllowed($data['warehouse_id']);
        $this->assertTenantOwnedAll(Product::class, $data['product_ids'] ?? [], 'المنتج');

        $stocktake = $this->domain(
            fn () => $this->stocktakes->open($data, $data['product_ids'] ?? [])
        );

        return (new StocktakeResource($stocktake->load(['lines.product', 'warehouse'])))
            ->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        $stocktake = Stocktake::with(['lines.product', 'warehouse'])->findOrFail($id);
        $this->assertRecordAccessible($stocktake->branch_id, [$stocktake->warehouse_id]);

        return (new StocktakeResource($stocktake))->response();
    }

    /** تسجيل العدّ: [{product_id, counted_quantity|null}, …] */
    public function count(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'counts'                    => ['required', 'array', 'min:1'],
            'counts.*.product_id'       => ['required', 'uuid'],
            'counts.*.counted_quantity' => ['nullable', 'integer', 'min:0', 'max:100000000'],
        ]);

        $stocktake = Stocktake::findOrFail($id);
        $this->assertRecordAccessible($stocktake->branch_id, [$stocktake->warehouse_id]);

        $counts = collect($request->input('counts'))
            ->mapWithKeys(fn ($c) => [$c['product_id'] => $c['counted_quantity'] ?? null])->all();

        $updated = $this->domain(fn () => $this->stocktakes->count($stocktake, $counts));

        return (new StocktakeResource($updated->load(['lines.product', 'warehouse'])))->response();
    }

    public function post(string $id): JsonResponse
    {
        $stocktake = Stocktake::findOrFail($id);
        $this->assertRecordAccessible($stocktake->branch_id, [$stocktake->warehouse_id]);

        $posted = $this->domain(fn () => $this->stocktakes->post($stocktake));

        return (new StocktakeResource($posted->load(['lines.product', 'warehouse'])))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $stocktake = Stocktake::findOrFail($id);
        $this->assertRecordAccessible($stocktake->branch_id, [$stocktake->warehouse_id]);

        if (! $stocktake->isDraft()) {
            abort(422, 'لا يمكن حذف جرد مرحَّل — صحّحه بجرد جديد أو إذن مخزني.');
        }
        $stocktake->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
