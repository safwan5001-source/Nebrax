<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelStation;
use App\Models\ProductWarehouseStock;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use RuntimeException;

/**
 * تقييم وردية **مغلقة** لمحرك ترحيل التسوية (P1-3b-2b) — قراءة فقط، بلا كتابة ولا قفل بذاته (المستدعي يقفل ثم يقيّم ثم يعيد التقييم تحت المِرساة).
 *
 * يختلف عن معاينة الوردية المفتوحة (`FuelShiftSettlementPreviewService`) في ثلاثة أمور مقصودة:
 *  1) **السعر يُحسم عند لحظة إغلاق الوردية** لا الآن (`compute($shift, closed_at)`): تغيّر سعر بعد الإغلاق لا يُعطّل ترحيل وردية سبقته، وتغيّره أثناء الوردية يبقى `price_changed`.
 *  2) **تاريخ التوريد التجاري = يوم إغلاق الوردية بتقويم المحطة** (D-P: فترة مفتوحة أو لا ترحيل). الفترة المقفلة تُفحص على هذا التاريخ لا على اليوم.
 *  3) **ERP = مبيعات المحطة النهائية بمصدر `station` فقط**: بيع أنشأته التسوية (`source = settlement`) لا يُعدّ بيع ERP فلا يُحسب مرتين.
 * يعيد الحجب والحالات بنفس رموز المعاينة وتستعمل دوالها العامة نفسها (حجب التكلفة/الفترة/الإيصالات غير الموسومة) كي لا يتشعّب الحكم.
 */
class FuelShiftSettlementEvaluator
{
    public function __construct(
        private FuelShiftSalesCalculator $calculator,
        private FuelShiftSettlementPreviewService $preview,
        private FuelShiftSettlementReadiness $readiness,
        private FuelStationSettingsService $settings,
    ) {}

    /**
     * @return array{
     *   blockers:list<string>, tax_mode:?string, hash:string,
     *   supply:array{started_at:string,ended_at:string,business_date:string},
     *   lines:list<array<string,mixed>>,
     *   finance:array<string,mixed>, collection:array{collected_at:?string,collection_date:?string,declaration_revision:?int}
     * }
     */
    public function evaluate(FuelShift $shift, CarbonInterface $now): array
    {
        if ($shift->status !== FuelShift::STATUS_CLOSED && $shift->status !== FuelShift::STATUS_APPROVED) {
            throw new RuntimeException('FUEL_SETTLEMENT_EVALUATOR_SHIFT_NOT_CLOSED: التقييم لوردية مغلقة أو معتمدة فقط.');
        }
        if ($shift->closed_at === null || $shift->opened_at === null) {
            throw new RuntimeException('FUEL_SETTLEMENT_EVALUATOR_SHIFT_TIMES_MISSING: وردية بلا لحظتَي فتح وإغلاق.');
        }

        $station = FuelStation::findOrFail($shift->fuel_station_id);
        $closedAt = CarbonImmutable::instance($shift->closed_at);
        $supply = [
            'started_at' => CarbonImmutable::instance($shift->opened_at)->utc()->format('Y-m-d H:i:s'),
            'ended_at' => $closedAt->utc()->format('Y-m-d H:i:s'),
            'business_date' => $this->settings->businessDate($station, $closedAt),
        ];

        // فحوص الوردية المغلقة الموحَّدة (جاهزية المحطة، الإقرار، عبور الشهر، الفترة المقفلة على تاريخ التوريد، الإيصالات غير الموسومة).
        $blockers = $this->preview->closedShiftPrechecks($shift);

        $sales = $this->calculator->compute($shift, $closedAt);
        if (! $sales['milliliters_complete']) {
            $blockers[] = 'FUEL_SETTLEMENT_METER_INCOMPLETE';
        }

        // مبيعات ERP النهائية للوردية بمصدر `station` وحده (لا بيع تسوية سابق).
        $erpByNozzle = FuelSale::query()->where('fuel_shift_id', $shift->id)->where('status', FuelSale::STATUS_FINALIZED)
            ->where('source', 'station')->get()->groupBy('fuel_nozzle_id')
            ->map(fn ($group) => (int) $group->sum('quantity_milliliters'));

        $products = collect($sales['products'])->keyBy('fuel_product_id');
        $fuelProducts = FuelProduct::query()->whereIn('id', $products->keys()->all())->get()->keyBy('id');
        $taxMode = $sales['tax_mode'];

        $lines = [];
        foreach ($sales['nozzles'] as $nozzle) {
            $metered = $nozzle['milliliters'];
            $erp = (int) ($erpByNozzle[$nozzle['nozzle_id']] ?? 0);
            $line = [
                'nozzle_id' => $nozzle['nozzle_id'], 'nozzle_number' => $nozzle['nozzle_number'], 'fuel_product_id' => $nozzle['fuel_product_id'],
                'metered_milliliters' => $metered, 'erp_milliliters' => $erp, 'residual_milliliters' => null,
                'price_per_liter_minor' => null, 'expected_gross_minor' => null, 'state' => 'unavailable',
                'withheld_reason' => null, 'pending_value_minor' => null,
            ];
            if ($metered === null) {
                $lines[] = $line;
                continue;
            }
            $residual = $metered - $erp;
            $line['residual_milliliters'] = $residual;
            if ($residual < 0) {
                $blockers[] = 'FUEL_SETTLEMENT_ERP_EXCEEDS_METER';
                $line['state'] = 'blocked_erp_exceeds_meter';
                $lines[] = $line;
                continue;
            }
            if ($residual === 0) {
                $line['state'] = 'no_residual';
                $lines[] = $line;
                continue;
            }

            $productRow = $products->get($nozzle['fuel_product_id']);
            foreach ((array) ($productRow['gaps'] ?? []) as $gap) {
                $blockers[] = match ($gap) {
                    FuelShiftSalesCalculator::GAP_PRICE_CHANGED => 'FUEL_SETTLEMENT_PRICE_CHANGED',
                    FuelShiftSalesCalculator::GAP_PRICE_UNAVAILABLE => 'FUEL_SETTLEMENT_PRICE_UNAVAILABLE',
                    FuelShiftSalesCalculator::GAP_TAX_MODE_UNSET => 'FUEL_SETTLEMENT_NOT_READY_TAX_MODE_UNSET',
                    FuelShiftSalesCalculator::GAP_PRODUCT_UNAVAILABLE => 'FUEL_SETTLEMENT_PRODUCT_UNAVAILABLE',
                    default => null,
                };
            }
            $price = $productRow['price_per_liter_minor'] ?? null;
            if ($price === null) {
                $blockers[] = 'FUEL_SETTLEMENT_PRICE_UNAVAILABLE';   // بقية بلا سعر لا تُستبعد صامتةً
                $lines[] = $line;
                continue;
            }
            $line['price_per_liter_minor'] = (int) $price;
            $line['expected_gross_minor'] = $this->calculator->amountFor($residual, (int) $price, $taxMode);
            if ($line['expected_gross_minor'] <= 0) {
                // باقٍ ضئيل بسعر منخفض يُقرَّب إلى قيمة صفرية: لا فاتورة بقيمة صفر ولا استبعاد صامت.
                $blockers[] = 'FUEL_SETTLEMENT_ZERO_VALUE_RESIDUAL';
                $line['state'] = 'blocked_zero_value';
                $lines[] = $line;
                continue;
            }

            // الحجب على مستوى السطر: عبور حدّ شهر / تاريخ مفتوح للمجمّع / حدث تكلفة داخل نافذة التعرّض الممتدة إلى لحظة الترحيل (`$now`).
            $product = $fuelProducts->get($nozzle['fuel_product_id']);
            $withheld = $product !== null ? $this->preview->withholdReason($shift, $station, $product, $now) : null;
            if ($withheld !== null) {
                $line['state'] = $withheld;
                $line['withheld_reason'] = $withheld;
                $line['pending_value_minor'] = $line['expected_gross_minor'];
            } else {
                $line['state'] = 'posted';
            }
            $lines[] = $line;
        }

        // كفاية الرصيد الدفتري للسطور القابلة للترحيل (المنتج × مخزن المحطة).
        $postableByProduct = [];
        foreach ($lines as $line) {
            if ($line['state'] === 'posted') {
                $postableByProduct[$line['fuel_product_id']] = ($postableByProduct[$line['fuel_product_id']] ?? 0) + (int) $line['residual_milliliters'];
            }
        }
        foreach ($postableByProduct as $productId => $milliliters) {
            $product = $fuelProducts->get($productId);
            $onHand = (int) (ProductWarehouseStock::query()->where('warehouse_id', $station->warehouse_id)->where('product_id', $product?->product_id)->value('quantity') ?? 0);
            if ($milliliters > $onHand) {
                $blockers[] = 'FUEL_SETTLEMENT_INSUFFICIENT_STOCK';
            }
        }

        // التخصيص والفروق (الشبكة أولاً ثم النقد) بالخوارزمية الوحيدة نفسها التي تعرضها المعاينة؛ ERP هنا بمصدر `station` وحده.
        $walkIn = $this->readiness->walkInPartner($station);
        $stationSales = FuelSale::query()->where('fuel_shift_id', $shift->id)->where('status', FuelSale::STATUS_FINALIZED)
            ->where('source', 'station')->orderBy('finalized_at')->orderBy('id')->get();
        $finance = $this->preview->finance($shift, $station, $walkIn?->id, $lines, [], $stationSales);
        foreach ($finance['blockers'] as $blocker) {
            $blockers[] = $blocker;
        }

        // تاريخ التحصيل الفعلي: لحظة إقرار التحصيل (دليل العدّ والتسليم) بيومها التجاري في المحطة — **مستقل** عن تاريخ التوريد.
        $declaration = FuelShiftCollectionDeclaration::query()->where('fuel_shift_id', $shift->id)->first();
        $collection = ['collected_at' => null, 'collection_date' => null, 'declaration_revision' => $declaration?->revision];
        if ($declaration?->declared_at !== null) {
            $declaredAt = CarbonImmutable::instance($declaration->declared_at);
            $collection['collected_at'] = $declaredAt->utc()->format('Y-m-d H:i:s');
            $collection['collection_date'] = $this->settings->businessDate($station, $declaredAt);
            // فترة/سنة التحصيل مقفلة ⇒ لا ترحيل (لا تاريخ بديل)، وتُفحص على تاريخ التحصيل لا التوريد.
            if (($finance['allocation']['rows'] ?? []) !== [] && $this->preview->periodLocked($collection['collection_date'])) {
                $blockers[] = 'FUEL_SETTLEMENT_COLLECTION_PERIOD_LOCKED';
            }
        }

        $blockers = array_values(array_unique(array_filter($blockers)));
        sort($blockers);

        return [
            'blockers' => $blockers,
            'tax_mode' => $taxMode,
            'supply' => $supply,
            'lines' => $lines,
            'finance' => $finance,
            'collection' => $collection,
            'hash' => $this->hash($shift, $taxMode, $lines, $blockers, $supply, $finance, $collection),
        ];
    }

    /** بصمة حتمية لحالة التقييم: تستعمل لمقارنة التقييم قبل المِرساة وبعدها، ولتُخزَّن في الرأس. */
    private function hash(FuelShift $shift, ?string $taxMode, array $lines, array $blockers, array $supply, array $finance, array $collection): string
    {
        $canonical = [
            'shift' => $shift->id, 'tax_mode' => $taxMode, 'supply' => $supply, 'blockers' => $blockers, 'collection' => $collection,
            'allocation' => array_map(fn (array $r) => [$r['payment_method_id'], $r['target_kind'], $r['target_ref'], $r['nozzle_id'] ?? null, $r['invoice_id'], $r['amount_minor']], $finance['allocation']['rows'] ?? []),
            'variances' => $finance['variances'] ?? [], 'reference_total' => $finance['reference']['total_minor'] ?? null,
            'lines' => array_map(fn (array $l) => [
                $l['nozzle_id'], $l['state'], $l['metered_milliliters'], $l['erp_milliliters'], $l['residual_milliliters'], $l['price_per_liter_minor'],
            ], $lines),
        ];

        return hash('sha256', json_encode($canonical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
