<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Services\Accounting\UnitConversion;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProductPricingService — السلطة الأساسية للتسعير (VAR-PRICE-1)
 * ═══════════════════════════════════════════════════════════════
 *  السعر الأساسي الصريح لهويّةٍ قابلة للبيع (منتجٌ بسيط/أبٌ، أو متغيّرٌ فعلي)
 *  + وحدة — **بمعزل عن قوائم الأسعار** (تلك تبقى مسؤولية `PriceListService`
 *  حصراً، وتظل الأسبقية الأعلى فوق هذا المصدر — @see CommercePriceResolver).
 *
 *  لا يشتقّ سعر وحدةٍ بديلة من سعر وحدةٍ أخرى بضرب معامل التحويل أبداً — هذا
 *  الصنف لا يقرأ `UnitTemplateUnit.factor` إلا لتطبيع اسم الوحدة نفسه
 *  (`UnitConversion::resolve()`)، لا لحساب سعر.
 *
 *  **الضمان الذرّي حقيقةً هو القيد الفريد الجزئي في قاعدة البيانات، لا
 *  `firstOrCreate` وحدها** — نفس تحذير `InventoryState`/`SkuRegistryEntry` حرفياً.
 */
class ProductPricingService
{
    public function __construct(protected UnitConversion $units) {}

    /**
     * السعر الصريح المخزَّن لهذه الهويّة والوحدة تحديداً — **بلا تراجع**.
     * `null` يعني ببساطة «لا سعرٌ صريحٌ هنا»، لا صفراً.
     */
    public function resolveExplicit(Product $product, ?ProductVariant $variant, ?string $unitName): ?int
    {
        $this->assertIdentityConsistent($product, $variant);
        $storedUnit = $this->storedUnitName($product, $unitName);

        $price = ProductUnitPrice::where('product_id', $product->id)
            ->where('product_variant_id', $variant?->id)
            ->where('unit_name', $storedUnit)
            ->value('price');

        return $price === null ? null : (int) $price;
    }

    /**
     * السعر القابل للبيع لمتغيّرٍ فعلي، بتراجعٍ **لنفس الوحدة حصراً**:
     * سعر المتغيّر الصريح ← وإلا سعر المنتج الأساسي لنفس الوحدة ← وإلا لا سعر.
     * لا تراجع عبر وحداتٍ مختلفة أبداً (العقد البند ٦).
     *
     * لمنتجٍ بسيط (`$variant = null`) تكافئ `resolveExplicit()` تماماً — لا
     * هويّة أخرى تُراجَع.
     */
    public function resolveSellable(Product $product, ?ProductVariant $variant, ?string $unitName): ?int
    {
        if ($variant === null) {
            return $this->resolveExplicit($product, null, $unitName);
        }

        $explicit = $this->resolveExplicit($product, $variant, $unitName);
        if ($explicit !== null) {
            return $explicit;
        }

        return $this->resolveExplicit($product, null, $unitName);
    }

    /**
     * يُنشئ أو يستبدل السعر الأساسي الصريح لهويّةٍ ووحدةٍ محدَّدتين، بقفلٍ
     * وإعادة قراءةٍ عند تصادم القيد الفريد الجزئي (سباق إنشاء أوّل).
     */
    public function setPrice(Product $product, ?ProductVariant $variant, ?string $unitName, int $price): ProductUnitPrice
    {
        if ($price < 0) {
            throw new RuntimeException('السعر لا يكون سالباً.');
        }

        $this->assertIdentityConsistent($product, $variant);
        $storedUnit = $this->storedUnitName($product, $unitName);

        $keys = ['product_id' => $product->id, 'product_variant_id' => $variant?->id, 'unit_name' => $storedUnit];

        // القفل بلا معاملةٍ صريحة تُحرَّر فور جملته — الذرّية الحقيقية هنا هي
        // مسؤولية هذا الصنف نفسه (خلافاً لـ`InventoryService::applyReceipt()`
        // الذي يشترط معاملة المستدعي)، فيغلّف الصنف الوحيد مصدر السباق: إنشاء
        // أوّل أو تحديث سعرٍ قائم.
        return DB::transaction(function () use ($keys, $product, $price) {
            try {
                ProductUnitPrice::firstOrCreate($keys, ['tenant_id' => $product->tenant_id, 'price' => $price]);
            } catch (QueryException) {
                // سباقٌ على نفس الهويّة×الوحدة — القيد الفريد الجزئي في الترحيل
                // هو الضامن الحقيقي، لا `firstOrCreate` وحدها.
            }

            $row = ProductUnitPrice::where($keys)->lockForUpdate()->firstOrFail();
            if ((int) $row->price !== $price) {
                $row->update(['price' => $price]);
            }

            return $row->refresh();
        });
    }

    /** يحذف سعراً صريحاً إن وُجد — «لا سعر» بعده، لا صفرٌ ضمني. */
    public function clearPrice(Product $product, ?ProductVariant $variant, ?string $unitName): void
    {
        $this->assertIdentityConsistent($product, $variant);
        $storedUnit = $this->storedUnitName($product, $unitName);

        ProductUnitPrice::where('product_id', $product->id)
            ->where('product_variant_id', $variant?->id)
            ->where('unit_name', $storedUnit)
            ->delete();
    }

    /** يطبّع اسم الوحدة إلى الاصطلاح المخزَّن نفسه المستعمَل في `PriceListService`: وحدة الأساس الحقيقية لا `null`. */
    private function storedUnitName(Product $product, ?string $unitName): string
    {
        [$resolvedUnit] = $this->units->resolve($product, $unitName);

        return $resolvedUnit ?? $product->unit;
    }

    /**
     * فشلٌ مغلَق قبل أي حلّ أو كتابة: عزلٌ صريح لا يعتمد على `TenantScope`
     * وحدها (دفاعٌ في العمق)، وربط المتغيّر بمنتجه الفعلي — يوازي
     * `InventoryService::assertIdentityConsistent()` حرفياً، بفارقٍ واحد
     * متعمَّد: لا يُرفض هنا منتجٌ `variant_managed` بلا متغيّر — سعره الأساسي
     * مرجعٌ تراجعيٌّ صالح ومعتمَد صراحةً (البند ٦)، لا هويّة مخزونٍ موازية.
     */
    private function assertIdentityConsistent(Product $product, ?ProductVariant $variant): void
    {
        if ($variant === null) {
            return;
        }

        if ($variant->product_id !== $product->id) {
            throw new RuntimeException('المتغيّر المحدَّد لا يتبع هذا المنتج.');
        }

        if ($variant->tenant_id !== $product->tenant_id) {
            throw new RuntimeException('تعارض عزل مستأجر بين المنتج والمتغيّر.');
        }
    }
}
