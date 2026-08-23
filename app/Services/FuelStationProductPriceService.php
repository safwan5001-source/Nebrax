<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationProductPrice;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** مصدر السعر الوحيد لبيع الوقود: override المحطة ثم default المستأجر ثم رفض صريح. */
class FuelStationProductPriceService
{
    /** @param array<string,mixed> $attributes */
    public function create(array $attributes, User $actor): FuelStationProductPrice
    {
        $fuelProductId = $this->requiredString($attributes, 'fuel_product_id');
        $stationId = $this->nullableId($attributes['fuel_station_id'] ?? null);
        $price = $this->positiveInteger($attributes['price_per_liter_minor'] ?? null, 'price_per_liter_minor');
        $effectiveFrom = $this->date($attributes['effective_from'] ?? null, 'effective_from');
        $effectiveUntil = array_key_exists('effective_until', $attributes) && $attributes['effective_until'] !== null
            ? $this->date($attributes['effective_until'], 'effective_until')
            : null;
        if ($effectiveUntil !== null && $effectiveUntil <= $effectiveFrom) {
            throw new RuntimeException('effective_until يجب أن يكون بعد effective_from.');
        }

        return DB::transaction(function () use ($fuelProductId, $stationId, $price, $effectiveFrom, $effectiveUntil, $attributes, $actor) {
            $fuelProduct = FuelProduct::lockForUpdate()->findOrFail($fuelProductId);
            if (! $fuelProduct->is_active) {
                throw new RuntimeException('لا يمكن تسعير منتج وقود غير نشط.');
            }
            $station = $stationId === null ? null : FuelStation::lockForUpdate()->findOrFail($stationId);
            if ($station !== null && $station->status !== FuelStation::STATUS_ACTIVE) {
                throw new RuntimeException('لا يمكن ضبط سعر لمحطة غير نشطة.');
            }

            $overlap = FuelStationProductPrice::where('fuel_product_id', $fuelProduct->id)
                ->when($station === null, fn ($query) => $query->whereNull('fuel_station_id'), fn ($query) => $query->where('fuel_station_id', $station->id))
                ->where('status', FuelStationProductPrice::STATUS_ACTIVE)
                ->where('effective_from', '<=', $effectiveUntil ?? '9999-12-31 23:59:59')
                ->where(function ($query) use ($effectiveFrom) {
                    $query->whereNull('effective_until')->orWhere('effective_until', '>', $effectiveFrom);
                })
                ->lockForUpdate()
                ->exists();
            if ($overlap) {
                throw new RuntimeException('تتداخل فترة السعر مع سعر وقود فعال موجود لنفس النطاق والمنتج.');
            }

            $priceRow = FuelStationProductPrice::create([
                'fuel_station_id' => $station?->id,
                'fuel_product_id' => $fuelProduct->id,
                'price_per_liter_minor' => $price,
                'effective_from' => $effectiveFrom,
                'effective_until' => $effectiveUntil,
                'status' => FuelStationProductPrice::STATUS_ACTIVE,
                'created_by' => $actor->id,
                'approved_by' => $attributes['approved_by'] ?? $actor->id,
                'reason' => $this->nullableText($attributes['reason'] ?? null),
            ]);

            FuelStationConfigurationEvent::create([
                'fuel_station_id' => $station?->id,
                'device_key' => '',
                'setting_key' => 'fuel_sales.price_per_liter_minor',
                'before' => null,
                'after' => $this->snapshot($priceRow),
                'changed_by' => $actor->id,
                'reason' => $priceRow->reason,
                'changed_at' => now(),
            ]);

            return $priceRow->fresh();
        });
    }

    public function effective(FuelStation $station, FuelProduct $fuelProduct, CarbonInterface $at): FuelStationProductPrice
    {
        $stationPrice = $this->effectiveForScope($fuelProduct->id, $station->id, $at);
        if ($stationPrice !== null) {
            return $stationPrice;
        }

        $tenantDefault = $this->effectiveForScope($fuelProduct->id, null, $at);
        if ($tenantDefault !== null) {
            return $tenantDefault;
        }

        throw new RuntimeException('FUEL_PRICE_NOT_CONFIGURED: لا يوجد سعر وقود فعال للمحطة أو للمستأجر في وقت البيع.');
    }

    private function effectiveForScope(string $fuelProductId, ?string $stationId, CarbonInterface $at): ?FuelStationProductPrice
    {
        return FuelStationProductPrice::where('fuel_product_id', $fuelProductId)
            ->when($stationId === null, fn ($query) => $query->whereNull('fuel_station_id'), fn ($query) => $query->where('fuel_station_id', $stationId))
            ->where('status', FuelStationProductPrice::STATUS_ACTIVE)
            ->where('effective_from', '<=', $at)
            ->where(function ($query) use ($at) {
                $query->whereNull('effective_until')->orWhere('effective_until', '>', $at);
            })
            ->orderByDesc('effective_from')
            ->first();
    }

    /** @return array<string,mixed> */
    private function snapshot(FuelStationProductPrice $price): array
    {
        return [
            'price_id' => $price->id,
            'fuel_station_id' => $price->fuel_station_id,
            'fuel_product_id' => $price->fuel_product_id,
            'price_per_liter_minor' => (int) $price->price_per_liter_minor,
            'effective_from' => $price->effective_from?->toIso8601String(),
            'effective_until' => $price->effective_until?->toIso8601String(),
            'status' => $price->status,
        ];
    }

    private function date(mixed $value, string $key): CarbonInterface
    {
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        try {
            return now()->parse($value);
        } catch (\Throwable) {
            throw new RuntimeException("{$key} يجب أن يكون تاريخاً صالحاً.");
        }
    }

    private function requiredString(array $attributes, string $key): string
    {
        $value = $attributes[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return trim($value);
    }

    private function nullableId(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException('fuel_station_id يجب أن يكون معرفاً صالحاً أو null للسعر الافتراضي.');
        }
        return trim($value);
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^[1-9][0-9]*$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        $integer = (int) $value;
        if ($integer <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        return $integer;
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new RuntimeException('reason يجب أن يكون نصاً.');
        }
        $value = trim($value);
        return $value === '' ? null : $value;
    }
}
