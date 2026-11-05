<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\Product;
use App\Models\ProductUnitPrice;
use App\Models\UnitTemplate;
use App\Support\FuelPriceException;
use App\Support\Settings;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * اقتراح سعر لتر الوقود من بطاقة المنتج الأصلية — **قراءة فقط ولا ينقل شيئاً**.
 *
 * مبدأ الإثبات: سعر الوحدة الأساس لمنتج الوقود (mL) ليس سعر لتر ولا يُحوَّل بالضرب. يُقبل اقتراحٌ
 * فقط إذا وُجد على البطاقة **سعرُ وحدةٍ صريح** (`ProductUnitPrice`) لوحدة في قالب وحدات المنتج
 * معاملها إلى mL يساوي 1000 تماماً (لتر مُثبَت بالمعامل لا بالاسم)، وكانت كل فحوص الوحدة والضريبة سليمة.
 * أي غموض ⇒ `blocked` برموز `blockers` (لا fallback ولا تخمين). سعر البطاقة الخام لا يُعاد في الاستجابة.
 *
 * أساس الضريبة: بطاقة المنتج لا تصرّح بشمول سعرها للضريبة، فلا يُثبَت من البيانات. لذلك الاقتراح يفترض
 * أساس نمط ضريبة الوقود للنطاق الهدف **ويشترط إقراراً صريحاً من المستخدم** (`source.confirm_tax_mode`) قبل الحفظ،
 * ويُتحقَّق من تطابقه مع النمط المعمول به وقت الحفظ. الإقرار شهادة مستخدم لا برهان نظام، ويُسجَّل في التدقيق.
 */
class FuelPriceSuggestionService
{
    public const STATUS_AVAILABLE = 'available';
    public const STATUS_BLOCKED = 'blocked';

    public function __construct(
        private FuelStationProductPriceService $prices,
        private FuelStationSettingsService $settings,
        private FuelQuantity $quantity,
    ) {}

    /**
     * @param  Collection<int, FuelProduct>  $fuelProducts
     * @return list<array<string, mixed>>
     */
    public function forScope(?FuelStation $station, Collection $fuelProducts, CarbonInterface $at): array
    {
        $taxMode = $this->taxMode($station);

        return $fuelProducts->map(fn (FuelProduct $fp) => $this->suggest($station, $fp, $taxMode, $at))->values()->all();
    }

    /**
     * يتحقق داخل معاملة الحفظ أن الاقتراح ما زال متاحاً ومطابقاً لما راجعه المستخدم وأقرّه.
     *
     * @throws FuelPriceException
     */
    public function assertConfirmed(?FuelStation $station, FuelProduct $fuelProduct, int $priceMinor, mixed $confirmedTaxMode, mixed $confirmedUnit): void
    {
        $now = now();
        $suggestion = $this->suggest($station, $fuelProduct, $this->taxMode($station), $now);
        if ($suggestion['status'] !== self::STATUS_AVAILABLE) {
            throw new FuelPriceException('suggestion_unavailable', 'اقتراح سعر بطاقة المنتج غير متاح؛ حدّد سعر اللتر يدوياً.', 422, ['blockers' => $suggestion['blockers']]);
        }
        if ($confirmedUnit !== 'L') {
            throw new FuelPriceException('suggestion_unit_unconfirmed', 'يلزم إقرار أن السعر لكل لتر.', 422);
        }
        if ($confirmedTaxMode !== $suggestion['tax_mode']) {
            throw new FuelPriceException('suggestion_tax_mode_mismatch', 'إقرار أساس الضريبة لا يطابق نمط ضريبة الوقود المعمول به.', 409, ['tax_mode' => $suggestion['tax_mode']]);
        }
        if ($priceMinor !== $suggestion['price_per_liter_minor']) {
            throw new FuelPriceException('suggestion_stale', 'تغيّر سعر بطاقة المنتج بعد المراجعة؛ أعد المراجعة.', 409, ['price_per_liter_minor' => $suggestion['price_per_liter_minor']]);
        }
    }

    /** @return array<string, mixed> */
    private function suggest(?FuelStation $station, FuelProduct $fp, ?string $taxMode, CarbonInterface $at): array
    {
        $blockers = [];
        $product = $fp->product;
        $cardUnit = null;
        $price = null;

        if (! $fp->is_active) {
            $blockers[] = 'product_inactive';
        }
        if ($product === null) {
            $blockers[] = 'product_link_missing';
        } else {
            try {
                $this->quantity->assertFuelUnitMapping($fp, $product);
            } catch (RuntimeException) {
                $blockers[] = 'unit_mapping_invalid';
            }
            if ($product->tax_rate !== null && (int) $product->tax_rate !== (int) Settings::get('sales', 'default_tax_rate')) {
                $blockers[] = 'tax_rate_mismatch';
            }
            [$cardUnit, $price, $unitBlocker] = $this->literCardPrice($product);
            if ($unitBlocker !== null) {
                $blockers[] = $unitBlocker;
            }
        }
        if ($taxMode === null) {
            $blockers[] = 'tax_mode_unset';
        }

        $current = $this->prices->effectiveInScope($fp->id, $station?->id, $at);

        return [
            'fuel_product_id' => $fp->id,
            'fuel_station_id' => $station?->id,
            'status' => $blockers === [] ? self::STATUS_AVAILABLE : self::STATUS_BLOCKED,
            'source' => 'product_card_unit_price',
            'price_per_liter_minor' => $blockers === [] ? $price : null,
            'unit' => 'L',
            'card_unit_name' => $cardUnit,
            'tax_mode' => $taxMode,
            'blockers' => $blockers,
            'current_scope_price_minor' => $current === null ? null : (int) $current->price_per_liter_minor,
            'matches_current' => $blockers === [] && $current !== null && (int) $current->price_per_liter_minor === $price,
        ];
    }

    /**
     * سعر الوحدة الصريح الذي يعادل لتراً بالمعامل. يعيد [اسم الوحدة, السعر, رمز الحجب].
     *
     * @return array{0: ?string, 1: ?int, 2: ?string}
     */
    private function literCardPrice(Product $product): array
    {
        if ($product->unit_template_id === null) {
            return [null, null, 'requires_liter_price'];
        }
        $template = UnitTemplate::query()->with('units')->find($product->unit_template_id);
        if ($template === null || $template->base_unit !== 'mL' || $template->base_unit !== $product->unit) {
            return [null, null, 'requires_liter_price'];
        }
        $literNames = $template->units->filter(fn ($unit) => (int) $unit->factor === 1000)->pluck('name')->all();
        if ($literNames === []) {
            return [null, null, 'requires_liter_price'];
        }

        $rows = ProductUnitPrice::query()
            ->where('product_id', $product->id)
            ->whereNull('product_variant_id')
            ->whereIn('unit_name', $literNames)
            ->get();
        if ($rows->isEmpty()) {
            return [null, null, 'requires_liter_price'];
        }
        if ($rows->count() > 1) {
            return [null, null, 'ambiguous_liter_price'];
        }
        $row = $rows->first();
        if ((int) $row->price <= 0) {
            return [$row->unit_name, null, 'price_not_positive'];
        }

        return [$row->unit_name, (int) $row->price, null];
    }

    private function taxMode(?FuelStation $station): ?string
    {
        if ($station !== null) {
            return $this->settings->fuelPriceTaxModeOrNull($station);
        }
        $mode = $this->settings->forTenant()['fuel_price_tax_mode'] ?? '';

        return in_array($mode, ['tax_inclusive', 'tax_exclusive'], true) ? $mode : null;
    }
}
