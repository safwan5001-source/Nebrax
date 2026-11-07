<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelTank */
class FuelTankResource extends JsonResource
{
    /**
     * TANK-BALANCE-P1: العقد الإضافي للرصيد الدفتري. يظهر فقط حين يستدعي المتحكّم `withBookLevel()` (قراءتا القائمة والعرض)؛
     * استجابات الإنشاء والتعديل وأي استدعاء آخر تبقى حرفياً كما كانت بلا المفتاحين.
     *
     * @var array{book_level: array<string,mixed>|null, book_level_unavailable_reason: string|null}|null
     */
    private ?array $bookLevel = null;

    /** @param array{book_level: array<string,mixed>|null, book_level_unavailable_reason: string|null} $payload */
    public function withBookLevel(array $payload): static
    {
        $this->bookLevel = $payload;

        return $this;
    }

    /**
     * @param  iterable<\App\Models\FuelTank>  $tanks
     * @param  array<string, array{book_level: array<string,mixed>|null, book_level_unavailable_reason: string|null}>  $levels  بمعرّف الخزان (من FuelTankBookBalanceReader)
     */
    public static function collectionWithBookLevels(iterable $tanks, array $levels): \Illuminate\Http\Resources\Json\AnonymousResourceCollection
    {
        $collection = static::collection($tanks);
        foreach ($collection->collection as $resource) {
            if (isset($levels[$resource->id])) {
                $resource->withBookLevel($levels[$resource->id]);
            }
        }

        return $collection;
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'name' => $this->station?->name, 'code' => $this->station?->code]),
            'fuel_product_id' => $this->fuel_product_id,
            'fuel_product' => $this->whenLoaded('fuelProduct', fn () => ['id' => $this->fuelProduct?->id, 'name' => $this->fuelProduct?->name, 'code' => $this->fuelProduct?->code]),
            'code' => $this->code,
            'name' => $this->name,
            'capacity_milliliters' => $this->capacity_milliliters,
            'safe_capacity_milliliters' => $this->safe_capacity_milliliters,
            'minimum_level_milliliters' => $this->minimum_level_milliliters,
            'dead_stock_milliliters' => $this->dead_stock_milliliters,
            'opening_volume_milliliters' => $this->opening_volume_milliliters,
            'measurement_configuration' => $this->measurement_configuration,
            'atg_source_key' => $this->atg_source_key,
            'status' => $this->status,
            'calibration_points' => $this->whenLoaded('calibrationPoints', fn () => $this->calibrationPoints->sortBy('level_millimeters')->map(fn ($point) => [
                'id' => $point->id,
                'level_millimeters' => $point->level_millimeters,
                'volume_milliliters' => $point->volume_milliliters,
            ])->values()),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ] + ($this->bookLevel ?? []);
    }
}
