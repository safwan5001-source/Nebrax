<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Support\FuelTankLevel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * FUEL-B6 — مراقبة مستويات الخزانات: قراءة فقط فوق `fuel_tanks` و`fuel_tank_readings`.
 *
 * لا يكتب شيئاً ولا يستدعي مخزوناً أو دفتراً أو تسوية. يعرض **آخر كمية مقاسة** وزمنها (لا رصيداً دفترياً)، ونسبة الامتلاء والسعة المتاحة،
 * وحالة حداثة القياس من إعداد المحطة (`tank_reading_stale_after_minutes`، غير المضبوط ⇒ `unrated`)، وأعلام المراجعة من قيم الخزان المعتمدة.
 * لا حدّ تنبيه مخترع. النطاق (مستأجر/فرع/مخزن/محطة مسنَدة) يفرضه المستدعي على استعلام الخزانات، والقراءات تُجلب بنطاق الفرع الآلي.
 */
final class FuelTankLevelMonitor
{
    public function __construct(private FuelQuantity $quantity, private FuelStationSettingsService $settings) {}

    /**
     * @param  Builder<FuelTank>  $tanks  استعلام خزانات مقيَّد النطاق مسبقاً (restrictToAccessibleStations)
     * @return list<array<string,mixed>>
     */
    public function snapshot(Builder $tanks): array
    {
        $rows = $tanks->with(['station', 'fuelProduct'])->where('status', '!=', FuelTank::STATUS_INACTIVE)->orderBy('code')->get();
        if ($rows->isEmpty()) {
            return [];
        }
        $latest = $this->latestReadings($rows->pluck('id')->all());
        $now = CarbonImmutable::now();
        $policies = [];

        return $rows->map(function (FuelTank $tank) use ($latest, $now, &$policies) {
            $byType = $latest[$tank->id] ?? [];
            $overall = null; // الأحدث قياساً بين النوعين، وعند التعادل الأحدث تسجيلاً
            foreach ($byType as $reading) {
                if ($overall === null
                    || $reading->measured_at->greaterThan($overall->measured_at)
                    || ($reading->measured_at->equalTo($overall->measured_at) && $reading->created_at->greaterThan($overall->created_at))) {
                    $overall = $reading;
                }
            }
            $stationId = $tank->fuel_station_id;
            $policies[$stationId] ??= $this->staleAfter($tank->station);
            $stale = $policies[$stationId];

            return [
                'tank' => [
                    'id' => $tank->id,
                    'code' => $tank->code,
                    'name' => $tank->name,
                    'status' => $tank->status,
                    'capacity_milliliters' => (int) $tank->capacity_milliliters,
                    'capacity_liters' => $this->quantity->millilitersToLiters((int) $tank->capacity_milliliters),
                    'safe_capacity_milliliters' => (int) $tank->safe_capacity_milliliters,
                    'minimum_level_milliliters' => (int) $tank->minimum_level_milliliters,
                    'dead_stock_milliliters' => (int) $tank->dead_stock_milliliters,
                ],
                'station' => ['id' => $tank->station?->id, 'code' => $tank->station?->code, 'name' => $tank->station?->name],
                'fuel_product' => ['id' => $tank->fuelProduct?->id, 'code' => $tank->fuelProduct?->code, 'name' => $tank->fuelProduct?->name],
                'latest' => $overall === null ? null : $this->readingRow($overall),
                'latest_by_type' => [
                    FuelTankReading::TYPE_PHYSICAL => isset($byType[FuelTankReading::TYPE_PHYSICAL]) ? $this->readingRow($byType[FuelTankReading::TYPE_PHYSICAL]) : null,
                    FuelTankReading::TYPE_ATG => isset($byType[FuelTankReading::TYPE_ATG]) ? $this->readingRow($byType[FuelTankReading::TYPE_ATG]) : null,
                ],
                'level' => $this->level($tank, $overall, $now, $stale),
            ];
        })->all();
    }

    /** @return array<string,mixed> */
    private function level(FuelTank $tank, ?FuelTankReading $reading, CarbonImmutable $now, ?int $staleAfter): array
    {
        $capacity = (int) $tank->capacity_milliliters;
        $safe = (int) $tank->safe_capacity_milliliters;
        $quantity = $reading === null ? null : (int) $reading->quantity_milliliters;
        $flags = $quantity === null ? [] : FuelTankLevel::flags($quantity, $capacity, $safe, (int) $tank->minimum_level_milliliters, (int) $tank->dead_stock_milliliters);

        return [
            'fill_basis_points' => $quantity === null ? null : FuelTankLevel::fillBasisPoints($quantity, $capacity),
            'available_milliliters' => $quantity === null ? null : max($capacity - $quantity, 0),
            'available_liters' => $quantity === null ? null : $this->quantity->millilitersToLiters(max($capacity - $quantity, 0)),
            'safe_available_milliliters' => $quantity === null ? null : max($safe - $quantity, 0),
            'age_seconds' => $reading === null ? null : max($now->getTimestamp() - $reading->measured_at->getTimestamp(), 0),
            'freshness' => FuelTankLevel::freshness($reading?->measured_at, $now, $staleAfter),
            'stale_after_minutes' => $staleAfter,
            'flags' => $flags,
            'needs_review' => $flags !== [],
        ];
    }

    /** @return array<string,mixed> */
    private function readingRow(FuelTankReading $reading): array
    {
        return [
            'id' => $reading->id,
            'reading_type' => $reading->reading_type,
            'quantity_milliliters' => (int) $reading->quantity_milliliters,
            'quantity_liters' => $this->quantity->millilitersToLiters((int) $reading->quantity_milliliters),
            'measured_at' => $reading->measured_at->toIso8601String(),
            'recorded_by' => $reading->recorded_by,
            'recorder' => $reading->recorder === null ? null : ['id' => $reading->recorder->id, 'name' => $reading->recorder->name],
            'evidence' => $reading->evidence,
        ];
    }

    private function staleAfter(?FuelStation $station): ?int
    {
        if ($station === null) {
            return null;
        }
        $value = $this->settings->get($station, 'tank_reading_stale_after_minutes');

        return is_int($value) && $value > 0 ? $value : null; // null أو '' (مسح على مستوى المؤسسة) ⇒ غير مضبوطة
    }

    /**
     * آخر قراءة لكل (خزان، نوع) باستعلام واحد (نافذة ROW_NUMBER) — بلا N+1. النطاق (مستأجر/فرع) يُطبَّق من Global Scopes داخل الاستعلام الفرعي.
     *
     * @param  list<string>  $tankIds
     * @return array<string, array<string, FuelTankReading>>
     */
    private function latestReadings(array $tankIds): array
    {
        $ranked = FuelTankReading::query()
            ->select('fuel_tank_readings.id')
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY fuel_tank_id, reading_type ORDER BY measured_at DESC, created_at DESC, id DESC) AS rn')
            ->whereIn('fuel_tank_id', $tankIds);
        $ids = DB::query()->fromSub($ranked, 'ranked')->where('rn', 1)->pluck('id')->all();
        if ($ids === []) {
            return [];
        }
        $out = [];
        /** @var Collection<int, FuelTankReading> $readings */
        $readings = FuelTankReading::query()->with('recorder')->whereIn('id', $ids)->get();
        foreach ($readings as $reading) {
            $out[$reading->fuel_tank_id][$reading->reading_type] = $reading;
        }

        return $out;
    }
}
