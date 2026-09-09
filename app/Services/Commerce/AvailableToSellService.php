<?php

namespace App\Services\Commerce;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Tenancy\BranchScope;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Available-to-Sell — القراءة الموثوقة الوحيدة لجاهزية البيع (PR-COM-1A/1B)
 * ═══════════════════════════════════════════════════════════════
 *
 * لا مصدر حقيقة موازياً هنا: `onHand` يُقرأ حصراً من
 * `product_warehouse_stock.quantity` — نفس الجدول والاستعلام الذي يعتمده
 * `InventoryService::assertStockAvailable()` للتحقق من توفر الكمية قبل
 * البيع/الإرجاع اليوم. لا حركة مخزون ولا قيد محاسبي ولا تعديل على
 * `products.quantity_on_hand`/`avg_cost` يصدر من هذه الخدمة — قراءة فقط،
 * بلا استثناء.
 *
 * `activeReserved` (منذ PR-COM-1B) مجموع `inventory_reservations.base_quantity`
 * لصفوف حالتها `active` لنفس المنتج والمخزن، عبر
 * `InventoryReservationService::activeReservedQuantity()` — لا عدّاد مجمَّع
 * موازٍ هنا. الاعتماد اتجاهٌ واحد (`AvailableToSellService` ←
 * `InventoryReservationService`) عمداً: `InventoryReservationService::acquire()`
 * يقرأ On Hand مباشرةً من `ProductWarehouseStock` دون المرور بهذا الصنف، فلا
 * تبعية دائرية بين الخدمتين.
 *
 * **مفتاح الموقع الفعلي هو `warehouse_id`** (`App\Models\Warehouse` +
 * `App\Models\ProductWarehouseStock`) — لا `Warehouse` aggregate جديد ولا
 * مصطلح Commerce موازٍ. ADR-02 يشترط ATS مرتبطاً بمخزن صراحةً، فالمخزن
 * إلزامي هنا؛ الفرع التاريخي بلا مخزن محدد (فرع `InventoryService` الذي
 * يقرأ `products.quantity_on_hand` الإجمالي عند غياب المخزن) خارج عقد
 * Commerce عمداً — ذلك مسار توافق تاريخي للمستندات، لا واجهة قراءة جديدة.
 *
 * الكميات هنا كمية أساس دائماً (لا تحويل وحدات هنا): `product_warehouse_stock`
 * و`products.quantity_on_hand` يُكتبان بالفعل بكمية الأساس بعد أن يحلّها
 * `UnitConversion` عند نقطة الإدخال (مشتريات/فواتير/أذون) — مُثبَتٌ في
 * `StockPermitUomValuationTest`. تكرار التحويل هنا كان سيُخاطر بازدواج
 * المعامل على قيمة محوَّلة أصلاً.
 *
 * العزل: `Product`/`Warehouse`/`ProductWarehouseStock` جميعها `BaseModel`
 * فتُصفَّى تلقائياً بـ`TenantScope` — لا حاجة لتمرير `tenant_id` ولا لأي
 * تجاوز له. `BranchScope` (لا `TenantScope`) يُتجاوَز صراحةً عند التحقق من
 * وجود المنتج فقط — بنفس نمط `InventoryReportService::trackedProducts()`
 * المعتمد فعلاً: ATS يُطلب بمخزنٍ محدَّد صراحةً من المستدعي، فتصفيته أيضاً
 * بالفرع «النشط» العابر لسياق الطلب كانت ستُخفي مخزوناً حقيقياً بلا سبب
 * متعلّق بالسؤال المطروح (كم يتوفر في *هذا* المخزن).
 */
final class AvailableToSellService
{
    public function __construct(
        private readonly InventoryReservationService $reservations,
    ) {}

    /**
     * @throws RuntimeException إذا كان المنتج أو المخزن غير موجودين لمستأجر السياق الحالي.
     */
    public function forWarehouse(string $productId, string $warehouseId): AvailableToSellSnapshot
    {
        $productExists = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereKey($productId)
            ->exists();

        if (! $productExists) {
            throw new RuntimeException('المنتج غير موجود.');
        }

        if (! Warehouse::whereKey($warehouseId)->exists()) {
            throw new RuntimeException('المخزن غير موجود.');
        }

        $onHand = (int) (ProductWarehouseStock::query()
            ->where('product_id', $productId)
            ->where('warehouse_id', $warehouseId)
            ->value('quantity') ?? 0);

        $activeReserved = $this->reservations->activeReservedQuantity($productId, $warehouseId);

        return new AvailableToSellSnapshot(
            onHand: $onHand,
            activeReserved: $activeReserved,
            availableToSell: max(0, $onHand - $activeReserved),
        );
    }
}
