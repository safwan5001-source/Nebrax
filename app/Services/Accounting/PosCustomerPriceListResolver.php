<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\PriceListService;
use App\Services\ProductPricingService;
use App\Support\PosSettings;

/**
 * يربط POS بقائمة السعر الافتراضية للعميل من مصدر واحد.
 *
 * لا يكتب هذا المحلّل فاتورة أو قيداً ولا يعيد تفسير لقطة سطر تاريخي؛ وظيفته
 * اقتراح/التحقق من سعر المنتج قبل إنشاء فاتورة جديدة فقط.
 */
class PosCustomerPriceListResolver
{
    public function __construct(protected PriceListService $priceLists, protected ProductPricingService $pricing) {}

    /** يعيد قائمة العميل النشطة فقط عندما تكون سياسة POS مفعلة. */
    public function forPartner(?string $partnerId): ?PriceList
    {
        if (! PosSettings::appliesCustomerPriceList() || $partnerId === null) {
            return null;
        }

        $partner = Partner::find($partnerId);
        if (! $partner || ! $partner->default_price_list_id) {
            return null;
        }

        $priceList = PriceList::find($partner->default_price_list_id);

        return $priceList?->is_active ? $priceList : null;
    }

    /**
     * سعر القائمة الصريح بالهللات إن وجد، وإلا سعر البيع الأساسي للمنتج/المتغيّر.
     * `$variant = null` يبقي سلوك المنتج البسيط كما كان حرفياً (VAR-POS-1
     * إضافةٌ لا كسر).
     */
    public function priceFor(?PriceList $priceList, Product $product, ?string $unitName = null, ?ProductVariant $variant = null): int
    {
        // `null` لا `$unitName`/`$product->unit` صراحةً: يعني «وحدة الأساس» في
        // كامل طبقة التسعير (`UnitConversion::resolve()`) بلا حاجة قالب وحدات
        // إطلاقاً — تمرير الاسم الصريح هنا كان يفشل لمنتجٍ بلا قالب أصلاً.
        $fallback = $variant !== null
            ? (int) ($this->pricing->resolveSellable($product, $variant, null) ?? 0)
            : (int) $product->sale_price;

        return $priceList
            ? ($this->priceLists->resolve($priceList, $product, $unitName, variant: $variant) ?? $fallback)
            : $fallback;
    }

    /**
     * سعر POS الملزم لوحدة السطر. وحدة الأساس تملك دائماً سعر المنتج أو سعرها
     * المخصص في القائمة، أما الوحدة البديلة فلا تُقبل بلا سعر صريح في قائمة
     * العميل النشطة؛ لا نشتق سعر عبوة من معامل التحويل.
     *
     * VAR-POS-1: `$variant` — منتجٌ متعدد الخيارات يُسعَّر على **متغيّره
     * الفعلي**، لا الأب أبداً (VAR-PRICE-1 «لا fallback على شقيقٍ»). وحدة
     * الأساس بلا متغيّرٍ صريح تسقط دائماً على `sale_price` **الأب** — لا معنى
     * له لمنتجٍ متعدد الخيارات، فهذه الحالة تُرفض في طبقةٍ أعلى (`DocumentLineVariantResolver`)
     * قبل الوصول هنا أصلاً؛ هذه الدالة تفترض هويّةً محلولةً سلفاً.
     */
    public function posPriceFor(?PriceList $priceList, Product $product, ?string $unitName, ?ProductVariant $variant = null): ?int
    {
        if (! $this->isAlternativeUnit($product, $unitName)) {
            // `null` لا `$unitName` نفسه: منتجٌ بلا قالب وحدات (الحالة الشائعة)
            // كان `UnitConversion::resolve()` يرفضه لمجرد تمرير اسم وحدةٍ صريح
            // ولو كان هو وحدة الأساس نفسها — `null` هو الاصطلاح الوحيد الآمن.
            return $this->priceFor($priceList, $product, null, $variant);
        }

        $listPrice = $priceList ? $this->priceLists->resolve($priceList, $product, $unitName, variant: $variant) : null;

        // VAR-PRICE-1: السلطة الأساسية الصريحة للوحدة البديلة — لم تكن موجودة
        // من قبل (كان الغياب هنا يعني «لا سعر» دائماً)، فهذه إضافة سلوك لا
        // كسرٌ له؛ لا اشتقاقٌ من معامل التحويل أبداً.
        return $listPrice ?? $this->pricing->resolveExplicit($product, $variant, $unitName);
    }

    /**
     * وحدات كتالوج POS: الأساس أولاً، ثم البدائل التي تملك سعراً صريحاً في
     * القائمة النشطة. يجمع عناصر القائمة في استعلام واحد ليبقى الكتالوج واسعاً
     * من دون استعلام لكل بطاقة منتج.
     *
     * @param iterable<Product> $products
     * @return array<string, array<int, array{name:string,factor:int,price:int}>>
     */
    public function catalogUnitsFor(?PriceList $priceList, iterable $products, ?array $preparedExplicit = null): array
    {
        $byId = [];
        foreach ($products as $product) {
            $byId[$product->id] = $product;
        }

        if ($byId === []) {
            return [];
        }

        // VAR-PRICE-1: `product_variant_id` موجودٌ الآن على هذا الجدول — استبعاده
        // صراحةً هنا إلزاميّ، وإلا اختلط سعرٌ خاصٌّ بمتغيّرٍ بعينه في كتالوج
        // المنتج نفسه (هذا المسار منتجٌ بسيط فقط — حدود POS، VAR-POS-1 لاحقاً).
        $listed = $priceList
            ? PriceListItem::where('price_list_id', $priceList->id)
                ->whereIn('product_id', array_keys($byId))
                ->whereNull('product_variant_id')
                ->get(['product_id', 'unit_name', 'price'])
                ->groupBy('product_id')
            : collect();

        $resolved = [];
        foreach ($byId as $id => $product) {
            $items = $listed->get($id, collect())->keyBy('unit_name');
            $baseUnit = $product->unit;
            $baseItem = $items->get($baseUnit);
            $basePrice = $baseItem
                ? (int) $baseItem->price
                : ($preparedExplicit !== null
                    ? ($this->preparedExplicit($preparedExplicit, $product, null, $baseUnit) ?? 0)
                    : (int) $product->sale_price);
            $units = [[
                'name' => $baseUnit,
                'factor' => 1,
                'price' => $basePrice,
            ]];

            // لا تظهر الوحدة البديلة إلا حين تملك سعراً صريحاً حقيقياً —
            // من قائمة السعر النشطة أولاً، وإلا السلطة الأساسية الصريحة
            // (VAR-PRICE-1). لا يصل خيارٌ تعرضه الواجهة إلى حارس يرفضه لاحقاً،
            // ولا يُشتقّ سعرٌ من معامل التحويل أبداً.
            if ($product->unitTemplate) {
                foreach ($product->unitTemplate->units as $unit) {
                    $item = $items->get($unit->name);
                    $price = $item
                        ? (int) $item->price
                        : $this->preparedExplicit($preparedExplicit, $product, null, $unit->name);
                    if ($price !== null) {
                        $units[] = [
                            'name' => $unit->name,
                            'factor' => (int) $unit->factor,
                            'price' => $price,
                        ];
                    }
                }
            }

            $resolved[$id] = $units;
        }

        return $resolved;
    }

    /**
     * VAR-POS-1 — سعر وحدة الأساس لكل متغيّرٍ فعلي في كتالوج POS (بطاقة
     * المنتج تعرض متغيّراتها النشطة بسعر كلٍّ منها، لا سعر الأب). نظير
     * `catalogUnitsFor()` تماماً لكن مصفوفته `product_variant_id` صريحة لا
     * `whereNull` — عكس استبعادها هناك تماماً.
     *
     * @param  iterable<ProductVariant>  $variants  كل المتغيّرات النشطة للمنتجات المعروضة (منتجاتها محمَّلة سلفاً)
     * @return array<string, int> معرّف المتغيّر ⇐ سعر وحدة الأساس بالهللات
     */
    public function catalogVariantPricesFor(?PriceList $priceList, iterable $variants, array $catalogProducts = [], ?array $preparedExplicit = null): array
    {
        $byId = [];
        foreach ($variants as $variant) {
            $byId[$variant->id] = $variant;
        }
        if ($byId === []) {
            return [];
        }

        $listed = $priceList
            ? PriceListItem::where('price_list_id', $priceList->id)
                ->whereIn('product_variant_id', array_keys($byId))
                ->get(['product_variant_id', 'unit_name', 'price'])
                ->keyBy('product_variant_id')
            : collect();

        $resolved = [];
        foreach ($byId as $id => $variant) {
            $product = $catalogProducts[$variant->product_id] ?? $variant->product;
            if ($product === null) {
                continue;
            }
            $item = $listed->get($id);
            if ($item !== null && $item->unit_name === $product->unit) {
                $resolved[$id] = (int) $item->price;

                continue;
            }
            $resolved[$id] = (int) ($this->preparedExplicit($preparedExplicit, $product, $variant, $product->unit)
                ?? $this->preparedExplicit($preparedExplicit, $product, null, $product->unit)
                ?? 0);
        }

        return $resolved;
    }

    private function isAlternativeUnit(Product $product, ?string $unitName): bool
    {
        $unitName = is_string($unitName) ? trim($unitName) : '';

        return $unitName !== '' && $unitName !== $product->unit;
    }

    /** @param array<string, array<string, array<string, int>>>|null $preparedExplicit */
    private function preparedExplicit(?array $preparedExplicit, Product $product, ?ProductVariant $variant, string $unitName): ?int
    {
        if ($preparedExplicit === null) {
            return $this->pricing->resolveExplicit($product, $variant, $unitName);
        }

        $variantKey = $variant?->id ?? '__base__';

        return $preparedExplicit[$product->id][$variantKey][$unitName] ?? null;
    }
}
