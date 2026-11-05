<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelStation;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * قراءة السعر الفعّال لمنتجات وقود محطة — للعرض (تطبيق المحطة) فقط، دون أي كتابة.
 *
 * لا قرار مستقل هنا: السعر من `FuelStationProductPriceService::resolve()` وهو نفسه ما يستعمله
 * `FuelSaleService::finalize` (عبر `effective()`)، ووضع الضريبة من `FuelStationSettingsService`
 * نفسها. فالمعروض هو المستعمل وقت الإنهاء ما لم يتغيّر الوقت/الإعداد بينهما. **لا fallback إلى
 * `Product.sale_price`** (انظر docs/fuel-stations/AWJ_FUEL_PRICE_SOURCE_AUDIT.md): غياب السعر يظهر
 * `not_configured` صريحاً، لا صفراً ولا سعر بطاقة المنتج.
 *
 * `blockers` تسرد أسباب رفض إنهاء البيع المتعلقة بالسعر والوحدة والضريبة وحدها؛ ليست فحص أهلية
 * بيع كاملاً (وردية/مخزون/تفويض شركات تبقى للخدمة). سعر عقد الشركات الخاص يخص بيعاً بتفويض ولا يظهر هنا.
 */
class FuelEffectivePriceReadService
{
    public const STATUS_EFFECTIVE = 'effective';
    public const STATUS_NOT_CONFIGURED = 'not_configured';
    public const STATUS_PRODUCT_INACTIVE = 'product_inactive';

    public const BLOCKER_PRICE_NOT_CONFIGURED = 'price_not_configured';
    public const BLOCKER_TAX_MODE_UNSET = 'tax_mode_unset';
    public const BLOCKER_PRODUCT_INACTIVE = 'product_inactive';
    public const BLOCKER_UNIT_MAPPING_INVALID = 'unit_mapping_invalid';

    public function __construct(
        private FuelStationProductPriceService $prices,
        private FuelStationSettingsService $settings,
        private FuelQuantity $quantity,
    ) {}

    /**
     * @param  Collection<int, FuelProduct>  $products
     * @return list<array<string, mixed>>
     */
    public function forStation(FuelStation $station, Collection $products, CarbonInterface $at): array
    {
        // وضع الضريبة قرار المحطة لا المنتج: يُقرأ مرة واحدة ويُطبَّق على كل صف.
        $taxMode = $this->settings->fuelPriceTaxModeOrNull($station);

        return $products->map(fn (FuelProduct $product) => $this->row($station, $product, $taxMode, $at))->values()->all();
    }

    /**
     * السعر الفعّال على مستوى المؤسسة (الافتراضي) فقط — لصفحة إدارة أسعار المؤسسة. نمط الضريبة هنا نمط المؤسسة؛
     * وقد تُخالفه محطات بإعداد خاص (يُعرض نمط كل محطة حين تُختار).
     *
     * @param  Collection<int, FuelProduct>  $products
     * @return list<array<string, mixed>>
     */
    public function forTenant(Collection $products, CarbonInterface $at): array
    {
        $mode = $this->settings->forTenant()['fuel_price_tax_mode'] ?? '';
        $taxMode = in_array($mode, ['tax_inclusive', 'tax_exclusive'], true) ? $mode : null;

        return $products->map(fn (FuelProduct $product) => $this->row(null, $product, $taxMode, $at))->values()->all();
    }

    /** @return array<string, mixed> */
    private function row(?FuelStation $station, FuelProduct $product, ?string $taxMode, CarbonInterface $at): array
    {
        $blockers = [];
        $resolved = null;
        if (! $product->is_active) {
            $status = self::STATUS_PRODUCT_INACTIVE;
            $blockers[] = self::BLOCKER_PRODUCT_INACTIVE;
        } else {
            $resolved = $station === null
                ? $this->tenantDefault($product, $at)
                : $this->prices->resolve($station, $product, $at);
            $status = $resolved === null ? self::STATUS_NOT_CONFIGURED : self::STATUS_EFFECTIVE;
            if ($resolved === null) {
                $blockers[] = self::BLOCKER_PRICE_NOT_CONFIGURED;
            }
        }
        if ($taxMode === null) {
            $blockers[] = self::BLOCKER_TAX_MODE_UNSET;
        }
        if (! $this->unitMappingValid($product)) {
            $blockers[] = self::BLOCKER_UNIT_MAPPING_INVALID;
        }

        $price = $resolved['price'] ?? null;

        return [
            'fuel_product_id' => $product->id,
            'fuel_station_id' => $station?->id,
            'status' => $status,
            'source' => $resolved['source'] ?? null,
            'price_id' => $price?->id,
            'price_per_liter_minor' => $price === null ? null : (int) $price->price_per_liter_minor,
            'unit' => 'L',
            'tax_mode' => $taxMode,
            'effective_from' => $price?->effective_from?->toIso8601String(),
            'effective_until' => $price?->effective_until?->toIso8601String(),
            'evaluated_at' => $at->toIso8601String(),
            'sellable' => $blockers === [],
            'blockers' => $blockers,
        ];
    }

    /** @return array{price: \App\Models\FuelStationProductPrice, source: string}|null */
    private function tenantDefault(FuelProduct $product, CarbonInterface $at): ?array
    {
        $price = $this->prices->effectiveInScope($product->id, null, $at);

        return $price === null ? null : ['price' => $price, 'source' => FuelStationProductPriceService::SOURCE_TENANT_DEFAULT];
    }

    /** نفس فحص الإنهاء: mL مخزناً وL عرضاً على FuelProduct، وmL على Product المرتبط. */
    private function unitMappingValid(FuelProduct $product): bool
    {
        try {
            $this->quantity->assertFuelUnitMapping($product, $product->product);
        } catch (RuntimeException) {
            return false;
        }

        return $product->product !== null;
    }
}
