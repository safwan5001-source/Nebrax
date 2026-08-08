<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreWarehouseRequest;
use App\Http\Resources\WarehouseResource;
use App\Models\Branch;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class WarehouseController extends ApiController
{
    public function index(): JsonResponse
    {
        return WarehouseResource::collection(Warehouse::orderBy('code')->get())->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new WarehouseResource(Warehouse::findOrFail($id)))->response();
    }

    public function store(StoreWarehouseRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $data['code'] = $this->uniqueCode($data['code'] ?? null);

        $warehouse = DB::transaction(function () use ($data) {
            // أول مخزن للمنشأة يصير الافتراضي تلقائياً.
            $data['is_default'] = ($data['is_default'] ?? false) || ! Warehouse::query()->exists();
            $w = Warehouse::create($data);
            if ($w->is_default) {
                $this->clearOtherDefaults($w->id);
            }

            return $w;
        });

        return (new WarehouseResource($warehouse))->response()->setStatusCode(201);
    }

    public function update(StoreWarehouseRequest $request, string $id): JsonResponse
    {
        $warehouse = Warehouse::findOrFail($id);
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');

        if (! empty($data['code']) && $data['code'] !== $warehouse->code) {
            $data['code'] = $this->uniqueCode($data['code'], $warehouse->id);
        } else {
            unset($data['code']);
        }

        DB::transaction(function () use ($warehouse, $data) {
            $warehouse->update($data);
            if ($warehouse->is_default) {
                $this->clearOtherDefaults($warehouse->id);
            }
        });

        return (new WarehouseResource($warehouse->fresh()))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $warehouse = Warehouse::findOrFail($id);

        // لا يُحذف مخزن يحمل رصيداً — الكمية لا تختفي بلا حركة.
        $hasStock = ProductWarehouseStock::where('warehouse_id', $id)->where('quantity', '!=', 0)->exists();
        if ($hasStock) {
            abort(422, 'لا يمكن حذف مخزن يحتوي على رصيد — انقل الكميات أولاً.');
        }
        if ($warehouse->is_default) {
            abort(422, 'لا يمكن حذف المخزن الافتراضي — عيّن مخزناً افتراضياً آخر أولاً.');
        }

        $warehouse->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** أرصدة الكميات لكل منتج داخل مخزن. */
    public function stock(string $id): JsonResponse
    {
        Warehouse::findOrFail($id);

        $rows = ProductWarehouseStock::with('product')
            ->where('warehouse_id', $id)
            ->get()
            ->map(fn ($r) => [
                'product_id' => $r->product_id,
                'name'       => $r->product?->name ?? '—',
                'sku'        => $r->product?->sku,
                'quantity'   => (int) $r->quantity,
            ])
            ->values();

        return response()->json(['data' => $rows]);
    }

    private function clearOtherDefaults(string $keepId): void
    {
        Warehouse::where('id', '!=', $keepId)->where('is_default', true)->update(['is_default' => false]);
    }

    private function uniqueCode(?string $code, ?string $exceptId = null): string
    {
        $code = trim((string) $code);
        if ($code === '') {
            return Warehouse::nextCode();
        }
        $taken = Warehouse::where('code', $code)
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            abort(422, 'كود المخزن مستخدم مسبقاً.');
        }

        return $code;
    }
}
