<?php

namespace App\Services\Reporting;

use App\Models\FuelNozzle;
use App\Models\FuelShift;
use App\Services\FuelShiftSalesCalculator;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * حقائق الورديات والعدادات لتقارير المبيعات: طبقة واحدة فوق `FuelShiftSalesCalculator` (المصدر الوحيد لمبيعات العدادات)،
 * فلا يكرَّر أي منطق مالي. قراءة فقط؛ كل استعلام عبر `FuelReportContext::scoped()` (المحطات المتاحة + الفرع).
 *
 * تخصيص مبلغ المنتج على فوهاته: المبلغ يُقرَّب مرة واحدة لكل منتج (كما في الحاسبة)، ثم يُوزَّع على الفوهات بالفرق التراكمي بترتيب الفوهات،
 * فيساوي مجموع الفوهات مبلغ المنتج بالهللة تماماً (لا فروق تقريب بين تقرير الفوهات وتقرير المنتجات).
 *
 * سقف: عدد الورديات المحسوبة لكل تشغيل `SHIFT_CAP` (الحساب لكل وردية استعلامات سعر وقراءات)؛ تجاوزه ⇒ `truncated` ويُطلب تضييق الفترة، ولا
 * تُقدَّم نتيجة جزئية كاملة.
 */
final class FuelReportShiftFacts
{
    public const SHIFT_CAP = 250;

    public function __construct(private FuelShiftSalesCalculator $calculator) {}

    /**
     * @param  array{0:string,1:string}|null  $period  فترة بديلة (للمقارنة)
     * @param  bool  $ignorePeriod  تجاهل الفترة (تقرير وردية بمعرّفها، أو الورديات المفتوحة)
     * @return array{shifts:list<array<string,mixed>>,truncated:bool,gaps:list<string>}
     */
    public function load(FuelReportContext $ctx, ?array $period = null, bool $withSales = true, bool $ignorePeriod = false): array
    {
        $basis = $ctx->filter('date_basis') === 'closed' ? 'closed_at' : 'opened_at';
        $query = $ctx->scoped(FuelShift::query()->with(['opener:id,name', 'closer:id,name', 'approver:id,name', 'staffAssignments.user:id,name']));
        if (! $ignorePeriod) {
            $ctx->constrainPeriod($query, $basis, 'fuel_station_id', $period);
        }
        if ($ctx->filter('status') !== null) {
            $query->where('status', $ctx->filter('status'));
        }
        if ($ctx->filter('shift_id') !== null) {
            $query->where('id', $ctx->filter('shift_id'));
        }
        if ($ctx->filter('user_id') !== null) {
            $userId = $ctx->filter('user_id');
            $query->where(fn (Builder $q) => $q->where('opened_by', $userId)->orWhereHas('staffAssignments', fn (Builder $a) => $a->where('user_id', $userId)));
        }

        $shifts = $query->orderBy($basis)->orderBy('id')->limit(self::SHIFT_CAP + 1)->get();
        $truncated = $shifts->count() > self::SHIFT_CAP;
        $shifts = $shifts->take(self::SHIFT_CAP);

        $catalog = $withSales ? $this->nozzleCatalog($ctx) : collect();
        $now = CarbonImmutable::now();
        $facts = [];
        $gaps = [];
        foreach ($shifts as $shift) {
            $stationId = (string) $shift->fuel_station_id;
            $fact = [
                'id' => $shift->id,
                'number' => $shift->number,
                'station_id' => $stationId,
                'station_name' => $ctx->stationName($stationId),
                'status' => $shift->status,
                'opened_at' => $shift->opened_at?->toIso8601String(),
                'closed_at' => $shift->closed_at?->toIso8601String(),
                'approved_at' => $shift->approved_at?->toIso8601String(),
                'date' => $ctx->businessDate($shift->{$basis}, $stationId),
                'duration_minutes' => $shift->opened_at === null ? null : (int) $shift->opened_at->diffInMinutes($shift->closed_at ?? $now),
                'opened_by' => $shift->opened_by,
                'opened_by_name' => $shift->opener?->name,
                'closed_by_name' => $shift->closer?->name,
                'approved_by_name' => $shift->approver?->name,
                'staff' => $shift->staffAssignments->map(fn ($a) => ['user_id' => $a->user_id, 'name' => $a->user?->name, 'role' => $a->role])->values()->all(),
                'model' => $shift,
            ];
            if ($withSales) {
                $fact += $this->sales($shift, $ctx, $catalog, $shift->closed_at ?? $now);
                foreach ($fact['gaps'] as $gap) {
                    $gaps[$gap] = true;
                }
            }
            $facts[] = $fact;
        }
        if ($truncated) {
            $gaps['shift_cap_reached'] = true;
        }

        return ['shifts' => $facts, 'truncated' => $truncated, 'gaps' => array_keys($gaps)];
    }

    /** @return \Illuminate\Support\Collection<string,FuelNozzle> */
    private function nozzleCatalog(FuelReportContext $ctx)
    {
        return FuelNozzle::query()->whereIn('fuel_station_id', $ctx->stationIds())->with(['pump', 'fuelProduct'])->get()->keyBy('id');
    }

    /**
     * @param  \Illuminate\Support\Collection<string,FuelNozzle>  $catalog
     * @return array{nozzles:list<array<string,mixed>>,products:list<array<string,mixed>>,milliliters:int,milliliters_complete:bool,amount_minor:?int,complete:bool,gaps:list<string>,tax_mode:?string}
     */
    private function sales(FuelShift $shift, FuelReportContext $ctx, $catalog, CarbonInterface $at): array
    {
        $calc = $this->calculator->compute($shift, $at);
        $productRows = collect($calc['products'])->keyBy('fuel_product_id');
        $nozzles = [];
        foreach ($calc['nozzles'] as $n) {
            $cat = $catalog->get($n['nozzle_id']);
            $nozzles[] = [
                'nozzle_id' => $n['nozzle_id'],
                'nozzle_number' => (string) $n['nozzle_number'],
                'pump_id' => $cat?->fuel_pump_id,
                'pump_label' => $cat?->pump === null ? null : ($cat->pump->name ?: (string) $cat->pump->pump_number),
                'product_id' => $n['fuel_product_id'],
                'product_name' => $cat?->fuelProduct?->name ?? ($productRows->get($n['fuel_product_id'])['name'] ?? null),
                'opening' => $n['opening_milliliters'],
                'closing' => $n['closing_milliliters'],
                'ml' => $n['milliliters'],
                'status' => $n['status'],
                'amount_minor' => null,
            ];
        }
        $nozzles = $this->allocate($nozzles, $productRows, $calc['tax_mode']);

        $filtered = $this->applyEquipmentFilters($nozzles, $ctx);
        $unfiltered = count($filtered) === count($nozzles);
        $ml = array_sum(array_map(fn ($n) => (int) ($n['ml'] ?? 0), $filtered));
        $mlComplete = ! in_array(true, array_map(fn ($n) => $n['ml'] === null, $filtered), true);
        $amountKnown = ! in_array(true, array_map(fn ($n) => $n['amount_minor'] === null, $filtered), true);
        $amount = $unfiltered ? $calc['amount_minor'] : ($amountKnown && $filtered !== [] ? array_sum(array_map(fn ($n) => (int) $n['amount_minor'], $filtered)) : null);

        $products = $unfiltered ? $calc['products'] : array_values(array_filter($calc['products'], fn ($p) => in_array($p['fuel_product_id'], array_column($filtered, 'product_id'), true)));

        return [
            'nozzles' => $filtered,
            'products' => $products,
            'milliliters' => $unfiltered ? $calc['milliliters'] : $ml,
            'milliliters_complete' => $unfiltered ? $calc['milliliters_complete'] : $mlComplete,
            'amount_minor' => $amount,
            'complete' => $amount !== null && ($unfiltered ? $calc['complete'] : $mlComplete),
            'gaps' => $calc['gaps'],
            'tax_mode' => $calc['tax_mode'],
        ];
    }

    /**
     * @param  list<array<string,mixed>>  $nozzles
     * @param  \Illuminate\Support\Collection<string,array<string,mixed>>  $productRows
     * @return list<array<string,mixed>>
     */
    private function allocate(array $nozzles, $productRows, ?string $taxMode): array
    {
        $byProduct = [];
        foreach ($nozzles as $index => $nozzle) {
            $byProduct[$nozzle['product_id']][] = $index;
        }
        foreach ($byProduct as $productId => $indexes) {
            $product = $productRows->get($productId);
            if ($product === null || $product['amount_minor'] === null || $product['price_per_liter_minor'] === null) {
                continue; // مبلغ المنتج غير موثوق ⇒ مبالغ فوهاته null (لا اختلاق)
            }
            usort($indexes, fn ($a, $b) => strnatcmp($nozzles[$a]['nozzle_number'], $nozzles[$b]['nozzle_number']) ?: strcmp((string) $nozzles[$a]['nozzle_id'], (string) $nozzles[$b]['nozzle_id']));
            $cumulativeMl = 0;
            $previous = 0;
            foreach ($indexes as $index) {
                $ml = $nozzles[$index]['ml'];
                if ($ml === null) {
                    continue;
                }
                $cumulativeMl += $ml;
                $cumulative = $this->calculator->amountFor($cumulativeMl, (int) $product['price_per_liter_minor'], $taxMode);
                $nozzles[$index]['amount_minor'] = $cumulative - $previous;
                $previous = $cumulative;
            }
        }

        return $nozzles;
    }

    /**
     * @param  list<array<string,mixed>>  $nozzles
     * @return list<array<string,mixed>>
     */
    private function applyEquipmentFilters(array $nozzles, FuelReportContext $ctx): array
    {
        $product = $ctx->filter('product_id');
        $pump = $ctx->filter('pump_id');
        $nozzle = $ctx->filter('nozzle_id');

        return array_values(array_filter($nozzles, fn ($n) => ($product === null || $n['product_id'] === $product)
            && ($pump === null || $n['pump_id'] === $pump)
            && ($nozzle === null || $n['nozzle_id'] === $nozzle)));
    }
}
