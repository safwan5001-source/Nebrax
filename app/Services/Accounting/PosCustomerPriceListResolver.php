<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
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

    /** سعر القائمة الصريح بالهللات إن وجد، وإلا سعر البيع الأساسي للمنتج. */
    public function priceFor(?PriceList $priceList, Product $product, ?string $unitName = null): int
    {
        return $priceList
            ? ($this->priceLists->resolve($priceList, $product, $unitName) ?? (int) $product->sale_price)
            : (int) $product->sale_price;
    }

    /**
     * سعر POS الملزم لوحدة السطر. وحدة الأساس تملك دائماً سعر المنتج أو سعرها
     * المخصص في القائمة، أما الوحدة البديلة فلا تُقبل بلا سعر صريح في قائمة
     * العميل النشطة؛ لا نشتق سعر عبوة من معامل التحويل.
     */
    public function posPriceFor(?PriceList $priceList, Product $product, ?string $unitName): ?int
    {
        if (! $this->isAlternativeUnit($product, $unitName)) {
            return $this->priceFor($priceList, $product, $unitName);
        }

        $listPrice = $priceList ? $this->priceLists->resolve($priceList, $product, $unitName) : null;

        // VAR-PRICE-1: السلطة الأساسية الصريحة للوحدة البديلة — لم تكن موجودة
        // من قبل (كان الغياب هنا يعني «لا سعر» دائماً)، فهذه إضافة سلوك لا
        // كسرٌ له؛ لا اشتقاقٌ من معامل التحويل أبداً.
        return $listPrice ?? $this->pricing->resolveExplicit($product, null, $unitName);
    }

    /**
     * وحدات كتالوج POS: الأساس أولاً، ثم البدائل التي تملك سعراً صريحاً في
     * القائمة النشطة. يجمع عناصر القائمة في استعلام واحد ليبقى الكتالوج واسعاً
     * من دون استعلام لكل بطاقة منتج.
     *
     * @param iterable<Product> $products
     * @return array<string, array<int, array{name:string,factor:int,price:int}>>
     */
    public function catalogUnitsFor(?PriceList $priceList, iterable $products): array
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
            $units = [[
                'name' => $baseUnit,
                'factor' => 1,
                'price' => $baseItem ? (int) $baseItem->price : (int) $product->sale_price,
            ]];

            // لا تظهر الوحدة البديلة إلا حين تملك سعراً صريحاً حقيقياً —
            // من قائمة السعر النشطة أولاً، وإلا السلطة الأساسية الصريحة
            // (VAR-PRICE-1). لا يصل خيارٌ تعرضه الواجهة إلى حارس يرفضه لاحقاً،
            // ولا يُشتقّ سعرٌ من معامل التحويل أبداً.
            if ($product->unitTemplate) {
                foreach ($product->unitTemplate->units as $unit) {
                    $item = $items->get($unit->name);
                    $price = $item ? (int) $item->price : $this->pricing->resolveExplicit($product, null, $unit->name);
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

    private function isAlternativeUnit(Product $product, ?string $unitName): bool
    {
        $unitName = is_string($unitName) ? trim($unitName) : '';

        return $unitName !== '' && $unitName !== $product->unit;
    }
}
