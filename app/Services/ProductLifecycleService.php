<?php

namespace App\Services;

use App\Models\CreditNoteLine;
use App\Models\InvoiceLine;
use App\Models\ProcurementLine;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductWarehouseStock;
use App\Models\PurchaseLine;
use App\Models\QuoteLine;
use App\Models\RecurringInvoiceLine;
use App\Models\ReturnLine;
use App\Models\StockMovement;
use App\Models\StockPermitLine;
use App\Models\StocktakeLine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * قواعد دورة حياة بطاقة المنتج أو الخدمة.
 *
 * هذا المسار لا يمسّ كمية المنتج أو متوسط تكلفته أو أي قيد. فهو يضبط الكتالوج
 * فقط، ويبقي الحركات والمستندات القائمة مراجع تاريخية قابلة للقراءة.
 */
class ProductLifecycleService
{
    /**
     * سجلات تمنع حذف المنتج؛ الحذف الناعم لبند مستخدم يجعل إعادة استعمال SKU أو
     * الباركود تضلل المستخدم وتترك مرجعاً تاريخياً باسم كتالوجي جديد.
     *
     * @return array<string, int>
     */
    public function referenceCounts(Product $product): array
    {
        return [
            'invoice_lines'          => InvoiceLine::where('product_id', $product->id)->count(),
            'purchase_lines'         => PurchaseLine::where('product_id', $product->id)->count(),
            'return_lines'           => ReturnLine::where('product_id', $product->id)->count(),
            'credit_note_lines'      => CreditNoteLine::where('product_id', $product->id)->count(),
            'quote_lines'            => QuoteLine::where('product_id', $product->id)->count(),
            'recurring_invoice_lines' => RecurringInvoiceLine::where('product_id', $product->id)->count(),
            'procurement_lines'      => ProcurementLine::where('product_id', $product->id)->count(),
            'stock_movements'        => StockMovement::where('product_id', $product->id)->count(),
            'stock_permit_lines'     => StockPermitLine::where('product_id', $product->id)->count(),
            'stocktake_lines'        => StocktakeLine::where('product_id', $product->id)->count(),
            'warehouse_stocks'       => ProductWarehouseStock::where('product_id', $product->id)->count(),
        ];
    }

    public function create(Product $product, ?string $userId): void
    {
        $this->record($product, 'created', [
            'name'              => [null, $product->name],
            'sku'               => [null, $product->sku],
            'type'              => [null, $product->type],
            'track_inventory'   => [null, $product->track_inventory],
            'is_active'         => [null, $product->is_active],
        ], $userId);
    }

    public function update(Product $product, array $data, ?string $userId): Product
    {
        return DB::transaction(function () use ($product, $data, $userId): Product {
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $this->assertInventoryIdentityCanChange($product, $data);

            $product->fill($data);
            $dirty = $product->getDirty();
            if ($dirty === []) {
                return $product;
            }

            $diff = [];
            foreach ($dirty as $field => $value) {
                $diff[$field] = [$product->getOriginal($field), $value];
            }
            $statusChanged = array_key_exists('is_active', $diff);

            $product->save();
            $this->record($product, $statusChanged ? 'status_changed' : 'updated', $diff, $userId);

            return $product;
        });
    }

    public function delete(Product $product, ?string $userId): void
    {
        $media = [];
        DB::transaction(function () use ($product, $userId, &$media): void {
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $counts = $this->referenceCounts($product);
            $used = array_filter($counts, static fn (int $count): bool => $count > 0);
            if ($used !== []) {
                $total = array_sum($used);
                throw new RuntimeException("لا يمكن حذف المنتج لأنه مرتبط بـ {$total} سجلّاً. عطّله بدلاً من ذلك حفاظاً على حركاته ومستنداته.");
            }

            $this->record($product, 'deleted', [
                'is_active' => [$product->is_active, false],
            ], $userId);
            // لا تبقى باركودات أو صور لمنتج حُذف فعلياً بلا مراجع. نحفظ
            // قائمة الملفات قبل حذف الصفوف، ثم ننظف التخزين بعد نجاح المعاملة.
            $media = $product->media()->get(['disk', 'path'])->all();
            $product->alternateBarcodes()->delete();
            $product->media()->delete();
            $product->delete();
        });

        foreach ($media as $item) {
            Storage::disk($item->disk)->delete($item->path);
        }
    }

    /** @return array<int, ProductActivity> */
    public function activity(Product $product): array
    {
        return ProductActivity::where('product_id', $product->id)
            ->with('user:id,name')
            ->latest('created_at')
            ->get()
            ->all();
    }

    /** @param array<string, mixed> $data */
    private function assertInventoryIdentityCanChange(Product $product, array $data): void
    {
        $changesType = array_key_exists('type', $data) && $data['type'] !== $product->type;
        $changesTracking = array_key_exists('track_inventory', $data)
            && (bool) $data['track_inventory'] !== (bool) $product->track_inventory;
        if (! $changesType && ! $changesTracking) {
            return;
        }

        $inventoryReferences = [
            'stock_movements'    => StockMovement::where('product_id', $product->id)->exists(),
            'stock_permit_lines' => StockPermitLine::where('product_id', $product->id)->exists(),
            'stocktake_lines'    => StocktakeLine::where('product_id', $product->id)->exists(),
            'warehouse_stocks'   => ProductWarehouseStock::where('product_id', $product->id)->exists(),
        ];
        if (in_array(true, $inventoryReferences, true)) {
            throw new RuntimeException('لا يمكن تغيير نوع المنتج أو تتبع مخزونه بعد وجود حركة أو رصيد مخزني. أنشئ منتجاً جديداً بدلاً من إعادة تفسير السجل التاريخي.');
        }
    }

    /** @param array<string, mixed> $diff */
    private function record(Product $product, string $action, array $diff, ?string $userId): void
    {
        ProductActivity::create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'action' => $action,
            'diff' => $diff,
            'user_id' => $userId,
        ]);
    }
}
