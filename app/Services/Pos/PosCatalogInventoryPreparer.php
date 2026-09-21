<?php

namespace App\Services\Pos;

use App\Models\InventoryState;
use App\Models\Product;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/**
 * يجهّز قيَم المخزون العارضة لكتالوج POS فقط.
 *
 * لا يغيّر أدوات Product العامة: كل مستهلك آخر يبقى على المصدر القائم
 * (`quantity_on_hand`/`avg_cost` من InventoryState). هذا التحضير يأتي بعد
 * حسم كتالوج المنتجات وفرعه، لذلك لا يوسّع الرؤية ولا يقرر إتاحة المخزن.
 */
final class PosCatalogInventoryPreparer
{
    public const QUANTITY_ATTRIBUTE = 'pos_catalog_quantity_on_hand';

    public const AVG_COST_ATTRIBUTE = 'pos_catalog_avg_cost';

    /** @param Collection<int, Product> $products */
    public function prepare(Collection $products): void
    {
        if ($products->isEmpty()) {
            return;
        }

        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return;
        }

        // النطاق صريح دفاعاً في العمق، فوق TenantScope الموجود على النموذج.
        // لا نحتاج إلا صفوف الهويّات الثلاثة أعلاه؛ لا مخزن ولا حركة ولا قيمة
        // محاسبية تدخل في كتالوج POS هنا.
        $statesByProduct = InventoryState::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('product_id', $products->modelKeys())
            ->get(['product_id', 'product_variant_id', 'quantity_on_hand', 'avg_cost'])
            ->groupBy('product_id');

        foreach ($products as $product) {
            $states = $statesByProduct->get($product->id, collect());

            if ($product->isVariantManaged()) {
                // يطابق Product::quantityOnHand(): مجموع كل حالات مخزون الأب.
                // لا متوسط تكلفة للأب متعدد الخيارات في العقد القائم.
                $product->setAttribute(self::QUANTITY_ATTRIBUTE, (int) $states->sum('quantity_on_hand'));
                $product->setAttribute(self::AVG_COST_ATTRIBUTE, 0);

                continue;
            }

            // يطابق Product::quantityOnHand()/avgCost() للمنتج البسيط: هوية
            // المنتج وحده هي الصف ذو product_variant_id = null.
            $simpleState = $states->firstWhere('product_variant_id', null);
            $product->setAttribute(self::QUANTITY_ATTRIBUTE, (int) ($simpleState?->quantity_on_hand ?? 0));
            $product->setAttribute(self::AVG_COST_ATTRIBUTE, (int) ($simpleState?->avg_cost ?? 0));
        }
    }
}
