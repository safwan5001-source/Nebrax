<?php

namespace App\Services;

use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelShift;
use App\Models\FuelShiftMeterReading;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Services\Accounting\InvoiceLinePrecision;
use App\Support\Settings;
use Carbon\CarbonInterface;
use RuntimeException;

/**
 * مبيعات الوردية المشتقة من العدادات — قراءة فقط، بلا أقفال ولا كتابة.
 *
 *   لكل فوهة:  الكمية = قراءة الإغلاق − قراءة الافتتاح (mL صحيحة)
 *   لكل منتج:  القيمة = الكمية × سعر اللتر الفعّال (نفس تقريب `InvoiceLinePrecision` الذي يستعمله بيع الوقود الرسمي)
 *
 * **السعر من الخدمة الموجودة فقط:** `FuelEffectivePriceReadService` فوق `FuelStationProductPriceService::resolve()` (محطة ← افتراضي المؤسسة)،
 * وبلا fallback إلى `Product.sale_price`. السعر يُحسم عند فتح الوردية وعند التقييم؛ اختلافهما أو وجود فترة سعر بدأت بينهما
 * ⇒ `price_changed_during_shift` (لا نوزّع لترات بين سعرين بالتخمين).
 *
 * **لا مبلغ غير موثوق:** أي قراءة ناقصة/غير طبيعية (إغلاق < افتتاح) أو سعر غير متاح أو نمط ضريبة غير معيَّن ⇒ `complete=false` و`amount_minor=null`
 * (لا إجمالي جزئي يُقدَّم كإجمالي). اللترات تُعاد دائماً مع علم اكتمالها.
 *
 * هذه المبيعات **تقدير تشغيلي من العدادات** — ليست فواتير بيع (`FuelSale`) ولا تتضمن أي بيع آجل أو تسوية غير مسجّلة.
 */
class FuelShiftSalesCalculator
{
    public const GAP_MISSING_READING = 'missing_reading';
    public const GAP_CLOSING_BELOW_OPENING = 'closing_below_opening';
    public const GAP_PRICE_UNAVAILABLE = 'price_unavailable';
    public const GAP_PRICE_CHANGED = 'price_changed_during_shift';
    public const GAP_TAX_MODE_UNSET = 'tax_mode_unset';
    public const GAP_PRODUCT_UNAVAILABLE = 'product_unavailable';
    public const GAP_NO_NOZZLES = 'no_nozzles';

    public function __construct(
        private FuelEffectivePriceReadService $prices,
        private InvoiceLinePrecision $precision,
    ) {}

    /**
     * @return array{
     *   evaluated_at:string, tax_mode:?string, milliliters:int, milliliters_complete:bool, amount_minor:?int, complete:bool,
     *   products:list<array<string,mixed>>, nozzles:list<array<string,mixed>>, gaps:list<string>
     * }
     */
    public function compute(FuelShift $shift, CarbonInterface $at): array
    {
        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $readings = FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->get()->groupBy('fuel_nozzle_id');
        $nozzles = FuelNozzle::where('fuel_station_id', $station->id)
            ->where(fn ($query) => $query->where('status', FuelNozzle::STATUS_ACTIVE)->orWhereIn('id', $readings->keys()->all()))
            ->orderBy('nozzle_number')
            ->get();

        $gaps = [];
        $nozzleRows = [];
        $byProduct = [];
        foreach ($nozzles as $nozzle) {
            $pair = $readings->get($nozzle->id, collect());
            $opening = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_OPENING);
            $closing = $pair->firstWhere('reading_stage', FuelShiftMeterReading::STAGE_CLOSING);
            $row = [
                'nozzle_id' => $nozzle->id,
                'nozzle_number' => $nozzle->nozzle_number,
                'fuel_product_id' => $nozzle->fuel_product_id,
                'opening_milliliters' => $opening?->meter_milliliters === null ? null : (int) $opening->meter_milliliters,
                'closing_milliliters' => $closing?->meter_milliliters === null ? null : (int) $closing->meter_milliliters,
                'milliliters' => null,
                'status' => 'ok',
            ];
            if ($opening === null || $closing === null) {
                $row['status'] = $opening === null && $closing === null ? 'missing_both' : ($opening === null ? 'missing_opening' : 'missing_closing');
                $gaps[self::GAP_MISSING_READING] = true;
                $byProduct[$nozzle->fuel_product_id]['gaps'][self::GAP_MISSING_READING] = true;
            } else {
                $delta = (int) $closing->meter_milliliters - (int) $opening->meter_milliliters;
                if ($delta < 0) {
                    // قراءة غير طبيعية: لا تدخل المجموع ولا تُصحَّح بالتخمين.
                    $row['status'] = 'closing_below_opening';
                    $gaps[self::GAP_CLOSING_BELOW_OPENING] = true;
                    $byProduct[$nozzle->fuel_product_id]['gaps'][self::GAP_CLOSING_BELOW_OPENING] = true;
                } else {
                    $row['milliliters'] = $delta;
                    $row['status'] = $delta === 0 ? 'no_movement' : 'ok';
                    $byProduct[$nozzle->fuel_product_id]['milliliters'] = ($byProduct[$nozzle->fuel_product_id]['milliliters'] ?? 0) + $delta;
                }
            }
            $byProduct[$nozzle->fuel_product_id]['nozzles'] = ($byProduct[$nozzle->fuel_product_id]['nozzles'] ?? 0) + 1;
            $nozzleRows[] = $row;
        }
        if ($nozzles->isEmpty()) {
            $gaps[self::GAP_NO_NOZZLES] = true;
        }

        $products = FuelProduct::whereIn('id', array_keys($byProduct))->get()->keyBy('id');
        $atOpen = $this->prices->forStation($station, $products->values(), $shift->opened_at ?? $at);
        $atEval = $this->prices->forStation($station, $products->values(), $at);
        $openRows = collect($atOpen)->keyBy('fuel_product_id');
        $evalRows = collect($atEval)->keyBy('fuel_product_id');
        $taxMode = $evalRows->first()['tax_mode'] ?? null;

        $productRows = [];
        $totalMl = 0;
        $totalAmount = 0;
        $amountComplete = ! isset($gaps[self::GAP_NO_NOZZLES]);
        foreach ($byProduct as $productId => $data) {
            $product = $products->get($productId);
            $productGaps = array_keys($data['gaps'] ?? []);
            $ml = (int) ($data['milliliters'] ?? 0);
            $totalMl += $ml;
            $eval = $evalRows->get($productId);
            $open = $openRows->get($productId);
            $row = [
                'fuel_product_id' => $productId,
                'name' => $product?->name,
                'nozzle_count' => (int) $data['nozzles'],
                'milliliters' => $ml,
                'price_per_liter_minor' => null,
                'price_source' => null,
                'amount_minor' => null,
                'gaps' => [],
            ];

            if ($product === null || $eval === null) {
                $productGaps[] = self::GAP_PRODUCT_UNAVAILABLE;
            } else {
                foreach ($eval['blockers'] as $blocker) {
                    $productGaps[] = match ($blocker) {
                        FuelEffectivePriceReadService::BLOCKER_PRICE_NOT_CONFIGURED => self::GAP_PRICE_UNAVAILABLE,
                        FuelEffectivePriceReadService::BLOCKER_TAX_MODE_UNSET => self::GAP_TAX_MODE_UNSET,
                        default => self::GAP_PRODUCT_UNAVAILABLE,
                    };
                }
                if ($eval['status'] === FuelEffectivePriceReadService::STATUS_EFFECTIVE) {
                    $row['price_per_liter_minor'] = $eval['price_per_liter_minor'];
                    $row['price_source'] = $eval['source'];
                    if (($open['price_id'] ?? null) !== $eval['price_id'] || $this->priceStartedBetween($station, $productId, $shift->opened_at ?? $at, $at)) {
                        $productGaps[] = self::GAP_PRICE_CHANGED;
                    }
                }
            }

            $productGaps = array_values(array_unique($productGaps));
            if ($productGaps === [] && $row['price_per_liter_minor'] !== null) {
                try {
                    $row['amount_minor'] = $this->amountFor($ml, (int) $row['price_per_liter_minor'], $taxMode);
                    $totalAmount += $row['amount_minor'];
                } catch (RuntimeException) {
                    $productGaps[] = self::GAP_PRODUCT_UNAVAILABLE;
                }
            }
            $row['gaps'] = $productGaps;
            foreach ($productGaps as $code) {
                $gaps[$code] = true;
            }
            $amountComplete = $amountComplete && $productGaps === [] && $row['amount_minor'] !== null;
            $productRows[] = $row;
        }

        $mlComplete = ! isset($gaps[self::GAP_MISSING_READING]) && ! isset($gaps[self::GAP_CLOSING_BELOW_OPENING]) && ! isset($gaps[self::GAP_NO_NOZZLES]);

        return [
            'evaluated_at' => $at->toIso8601String(),
            'tax_mode' => $taxMode,
            'milliliters' => $totalMl,
            'milliliters_complete' => $mlComplete,
            'amount_minor' => $amountComplete ? $totalAmount : null,
            'complete' => $amountComplete,
            'products' => $productRows,
            'nozzles' => $nozzleRows,
            'gaps' => array_keys($gaps),
        ];
    }

    /** مبلغ المنتج بالهللات: لتر×سعر بتقريب `half_up` مرة واحدة؛ وفي النمط غير الشامل تُضاف ضريبة المؤسسة الافتراضية (تقريب half_up). */
    public function amountFor(int $milliliters, int $pricePerLiterMinor, ?string $taxMode): int
    {
        if ($milliliters === 0) {
            return 0;
        }
        $line = $this->precision->fromItem([
            'quantity_numerator' => $milliliters,
            'quantity_denominator' => FuelQuantity::MILLILITERS_PER_LITER,
        ], $pricePerLiterMinor) ?? throw new RuntimeException('تعذر بناء تسعير الوقود النسبي.');
        $gross = (int) $line['rounded_gross_minor'];
        if ($taxMode !== 'tax_exclusive') {
            return $gross;
        }
        $rate = (int) Settings::get('sales', 'default_tax_rate');

        return $gross + intdiv($gross * $rate + 50, 100);
    }

    /** هل بدأت فترة سعر فعّالة لهذا المنتج (للمحطة أو الافتراضي) داخل (فتح الوردية، التقييم]؟ */
    private function priceStartedBetween(FuelStation $station, string $productId, CarbonInterface $from, CarbonInterface $to): bool
    {
        return FuelStationProductPrice::where('fuel_product_id', $productId)
            ->where('status', FuelStationProductPrice::STATUS_ACTIVE)
            ->where(fn ($query) => $query->whereNull('fuel_station_id')->orWhere('fuel_station_id', $station->id))
            ->where('effective_from', '>', $from)
            ->where('effective_from', '<=', $to)
            ->exists();
    }
}
