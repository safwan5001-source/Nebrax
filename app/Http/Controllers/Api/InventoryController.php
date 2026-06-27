<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\StockMovement;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

/**
 * تقرير المخزون — قراءة فقط. يعرض أرصدة الأصناف المتتبَّعة وقيمتها (متوسط متحرك)
 * وحركاتها. لا يولّد أي قيد محاسبي ولا يكتب في journal_*؛ القيم محسوبة من حقول
 * المنتج وحركات المخزون المسجّلة مسبقاً عبر InventoryService.
 */
class InventoryController extends ApiController
{
    public function index(): JsonResponse
    {
        $products = Product::where('track_inventory', true)->orderBy('name')->get();

        $items = $products->map(fn (Product $p) => [
            'id'               => $p->id,
            'sku'              => $p->sku,
            'name'             => $p->name,
            'unit'             => $p->unit,
            'quantity_on_hand' => $p->quantity_on_hand,
            'avg_cost'         => Money::toRiyal($p->avg_cost),
            'stock_value'      => Money::toRiyal($p->quantity_on_hand * $p->avg_cost),
        ])->values();

        $totalMinor = $products->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);

        return response()->json([
            'data'        => $items,
            'total_value' => Money::toRiyal($totalMinor),
        ]);
    }

    public function movements(string $productId): JsonResponse
    {
        // findOrFail يضمن وجود الصنف ضمن نطاق المستأجر (BaseModel + TenantScope).
        Product::findOrFail($productId);

        $rows = StockMovement::where('product_id', $productId)
            ->orderByDesc('movement_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (StockMovement $m) => [
                'id'               => $m->id,
                'type'             => $m->type,
                'quantity'         => $m->quantity,
                'unit_cost'        => Money::toRiyal($m->unit_cost),
                'total_cost'       => Money::toRiyal($m->total_cost),
                'balance_quantity' => $m->balance_quantity,
                'movement_date'    => optional($m->movement_date)->toDateString(),
                'notes'            => $m->notes,
            ]);

        return response()->json(['data' => $rows]);
    }
}
