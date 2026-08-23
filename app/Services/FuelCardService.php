<?php

namespace App\Services;

use App\Models\CorporateFuelAuditEvent;
use App\Models\CorporateFuelContract;
use App\Models\FuelCard;
use App\Models\FuelCardProduct;
use App\Models\FuelCardStation;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\Partner;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** إدارة بطاقة تفويض أعمال منطقية؛ البطاقة لا تمثل Payment أو نقداً أو RFID. */
class FuelCardService
{
    public function create(array $attributes, User $actor): FuelCard
    {
        return DB::transaction(function () use ($attributes, $actor) {
            [$partner, $contract] = $this->partnerAndContract($attributes);
            [$vehicle, $driver] = $this->vehicleAndDriver($attributes, $partner, $contract);
            $from = $this->date($attributes['effective_from'] ?? now());
            $until = $this->nullableDate($attributes['effective_until'] ?? null);
            $this->assertDateRange($from, $until);
            $this->assertStatus($attributes['status'] ?? FuelCard::STATUS_ACTIVE);
            $this->assertLimits($attributes);
            $this->assertRestrictions($attributes);
            $credential = $this->requiredText($attributes, 'credential');

            $card = FuelCard::create([
                'public_identifier' => $this->requiredText($attributes, 'public_identifier'),
                'credential_hash' => hash('sha256', $credential),
                'partner_id' => $partner->id,
                'corporate_fuel_contract_id' => $contract->id,
                'fuel_fleet_vehicle_id' => $vehicle?->id,
                'fuel_fleet_driver_id' => $driver?->id,
                'status' => $attributes['status'] ?? FuelCard::STATUS_ACTIVE,
                'effective_from' => $from,
                'effective_until' => $until,
                ...$this->limits($attributes),
                'station_restriction_mode' => $attributes['station_restriction_mode'] ?? FuelCard::RESTRICTION_ALL,
                'fuel_restriction_mode' => $attributes['fuel_restriction_mode'] ?? FuelCard::RESTRICTION_ALL,
                'allowed_time_windows' => $this->timeWindows($attributes['allowed_time_windows'] ?? null),
                'replaces_fuel_card_id' => $attributes['replaces_fuel_card_id'] ?? null,
                'created_by' => $actor->id,
            ]);
            $this->replaceRestrictions($card, $attributes);
            $this->assertRestrictionRows($card);
            $this->audit($card, 'card_created', null, $this->snapshot($card), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $card->fresh(['stations', 'fuelProducts']);
        });
    }

    /** البطاقة القائمة تقبل تغيير سياسة مستقبلية وحالة، لكن لا تُحرر هويتها أو عميلها أو عقدها. */
    public function update(FuelCard $card, array $attributes, User $actor): FuelCard
    {
        return DB::transaction(function () use ($card, $attributes, $actor) {
            $card = FuelCard::lockForUpdate()->findOrFail($card->id);
            $before = $this->snapshot($card);
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status']);
            }
            $this->assertLimits($attributes, $card);
            $this->assertRestrictions($attributes, $card);
            $from = array_key_exists('effective_from', $attributes) ? $this->date($attributes['effective_from']) : $card->effective_from;
            $until = array_key_exists('effective_until', $attributes) ? $this->nullableDate($attributes['effective_until']) : $card->effective_until;
            $this->assertDateRange($from, $until);

            $card->update([
                'status' => $attributes['status'] ?? $card->status,
                'effective_from' => $from,
                'effective_until' => $until,
                ...$this->limits($attributes, $card),
                'station_restriction_mode' => $attributes['station_restriction_mode'] ?? $card->station_restriction_mode,
                'fuel_restriction_mode' => $attributes['fuel_restriction_mode'] ?? $card->fuel_restriction_mode,
                'allowed_time_windows' => array_key_exists('allowed_time_windows', $attributes)
                    ? $this->timeWindows($attributes['allowed_time_windows']) : $card->allowed_time_windows,
            ]);
            $this->replaceRestrictions($card, $attributes);
            $this->assertRestrictionRows($card);
            $card = $card->fresh(['stations', 'fuelProducts']);
            $this->audit($card, 'card_updated', $before, $this->snapshot($card), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $card;
        });
    }

    /** الاستبدال يوقف البطاقة القديمة ولا يكشف أو ينسخ credential القديم. */
    public function replace(FuelCard $card, array $attributes, User $actor): FuelCard
    {
        return DB::transaction(function () use ($card, $attributes, $actor) {
            $card = FuelCard::lockForUpdate()->findOrFail($card->id);
            if (! in_array($card->status, [FuelCard::STATUS_ACTIVE, FuelCard::STATUS_LOST, FuelCard::STATUS_SUSPENDED], true)) {
                throw new RuntimeException('لا يمكن استبدال بطاقة ملغاة أو مستبدلة أو منتهية.');
            }
            $before = $this->snapshot($card);
            $card->update(['status' => FuelCard::STATUS_REPLACED]);
            $this->audit($card, 'card_replaced', $before, $this->snapshot($card), $actor, $this->nullableText($attributes['reason'] ?? null));

            $attributes['partner_id'] = $card->partner_id;
            $attributes['corporate_fuel_contract_id'] = $card->corporate_fuel_contract_id;
            $attributes['fuel_fleet_vehicle_id'] = $attributes['fuel_fleet_vehicle_id'] ?? $card->fuel_fleet_vehicle_id;
            $attributes['fuel_fleet_driver_id'] = $attributes['fuel_fleet_driver_id'] ?? $card->fuel_fleet_driver_id;
            foreach ([
                'per_transaction_milliliters', 'per_transaction_value_minor', 'daily_milliliters', 'daily_value_minor',
                'weekly_milliliters', 'weekly_value_minor', 'monthly_milliliters', 'monthly_value_minor',
                'daily_transaction_count', 'station_restriction_mode', 'fuel_restriction_mode', 'allowed_time_windows',
            ] as $key) {
                $attributes[$key] = array_key_exists($key, $attributes) ? $attributes[$key] : $card->{$key};
            }
            $attributes['station_ids'] = $attributes['station_ids'] ?? $card->stations()->pluck('fuel_station_id')->all();
            $attributes['fuel_product_ids'] = $attributes['fuel_product_ids'] ?? $card->fuelProducts()->pluck('fuel_product_id')->all();
            $attributes['replaces_fuel_card_id'] = $card->id;
            $new = $this->create($attributes, $actor);

            return $new->fresh(['stations', 'fuelProducts']);
        });
    }

    private function partnerAndContract(array $attributes): array
    {
        $partner = Partner::find($this->requiredText($attributes, 'partner_id'));
        if ($partner === null || ! $partner->isCustomer() || ! $partner->is_active) {
            throw new RuntimeException('بطاقة الوقود تتطلب عميلاً نشطاً من المستأجر الحالي.');
        }
        $contract = CorporateFuelContract::find($this->requiredText($attributes, 'corporate_fuel_contract_id'));
        if ($contract === null || $contract->partner_id !== $partner->id) {
            throw new RuntimeException('عقد بطاقة الوقود لا يخص العميل المحدد أو لا ينتمي إلى المستأجر.');
        }

        return [$partner, $contract];
    }

    private function vehicleAndDriver(array $attributes, Partner $partner, CorporateFuelContract $contract): array
    {
        $vehicle = null;
        if (($id = $attributes['fuel_fleet_vehicle_id'] ?? null) !== null) {
            $vehicle = FuelFleetVehicle::find($id);
            if ($vehicle === null || ($vehicle->partner_id !== null && $vehicle->partner_id !== $partner->id)
                || ($vehicle->corporate_fuel_contract_id !== null && $vehicle->corporate_fuel_contract_id !== $contract->id)) {
                throw new RuntimeException('مركبة البطاقة لا تخص العميل أو العقد الحالي.');
            }
        }
        $driver = null;
        if (($id = $attributes['fuel_fleet_driver_id'] ?? null) !== null) {
            $driver = FuelFleetDriver::find($id);
            if ($driver === null || ($driver->partner_id !== null && $driver->partner_id !== $partner->id)
                || ($driver->corporate_fuel_contract_id !== null && $driver->corporate_fuel_contract_id !== $contract->id)) {
                throw new RuntimeException('سائق البطاقة لا يخص العميل أو العقد الحالي.');
            }
        }

        return [$vehicle, $driver];
    }

    private function replaceRestrictions(FuelCard $card, array $attributes): void
    {
        if (array_key_exists('station_ids', $attributes)) {
            FuelCardStation::where('fuel_card_id', $card->id)->delete();
            foreach ($attributes['station_ids'] as $id) {
                $station = FuelStation::find($id);
                if ($station === null) {
                    throw new RuntimeException('قيد البطاقة يتضمن محطة غير موجودة أو لا تنتمي إلى المستأجر.');
                }
                FuelCardStation::create(['fuel_card_id' => $card->id, 'fuel_station_id' => $station->id]);
            }
        }
        if (array_key_exists('fuel_product_ids', $attributes)) {
            FuelCardProduct::where('fuel_card_id', $card->id)->delete();
            foreach ($attributes['fuel_product_ids'] as $id) {
                $fuelProduct = FuelProduct::find($id);
                if ($fuelProduct === null) {
                    throw new RuntimeException('قيد البطاقة يتضمن منتج وقود غير موجود أو لا ينتمي إلى المستأجر.');
                }
                FuelCardProduct::create(['fuel_card_id' => $card->id, 'fuel_product_id' => $fuelProduct->id]);
            }
        }
    }

    private function assertRestrictionRows(FuelCard $card): void
    {
        if ($card->station_restriction_mode === FuelCard::RESTRICTION_SELECTED && ! $card->stations()->exists()) {
            throw new RuntimeException('قيد محطات البطاقة selected يتطلب محطة واحدة على الأقل.');
        }
        if ($card->fuel_restriction_mode === FuelCard::RESTRICTION_SELECTED && ! $card->fuelProducts()->exists()) {
            throw new RuntimeException('قيد منتجات البطاقة selected يتطلب منتجاً واحداً على الأقل.');
        }
    }

    private function assertRestrictions(array $attributes, ?FuelCard $card = null): void
    {
        $stationMode = $attributes['station_restriction_mode'] ?? $card?->station_restriction_mode ?? FuelCard::RESTRICTION_ALL;
        $fuelMode = $attributes['fuel_restriction_mode'] ?? $card?->fuel_restriction_mode ?? FuelCard::RESTRICTION_ALL;
        if (! in_array($stationMode, FuelCard::RESTRICTION_MODES, true) || ! in_array($fuelMode, FuelCard::RESTRICTION_MODES, true)) {
            throw new RuntimeException('وضع قيود بطاقة الوقود يجب أن يكون all أو selected.');
        }
        foreach (['station_ids', 'fuel_product_ids'] as $key) {
            if (array_key_exists($key, $attributes) && (! is_array($attributes[$key]) || ! array_is_list($attributes[$key]) || count($attributes[$key]) !== count(array_unique($attributes[$key])))) {
                throw new RuntimeException('قوائم قيود بطاقة الوقود يجب أن تكون معرفات فريدة.');
            }
        }
        if ($stationMode === FuelCard::RESTRICTION_SELECTED && array_key_exists('station_ids', $attributes) && $attributes['station_ids'] === []) {
            throw new RuntimeException('قيد محطات البطاقة selected يتطلب محطة واحدة على الأقل.');
        }
        if ($fuelMode === FuelCard::RESTRICTION_SELECTED && array_key_exists('fuel_product_ids', $attributes) && $attributes['fuel_product_ids'] === []) {
            throw new RuntimeException('قيد منتجات البطاقة selected يتطلب منتجاً واحداً على الأقل.');
        }
    }

    private function limits(array $attributes, ?FuelCard $card = null): array
    {
        $keys = [
            'per_transaction_milliliters', 'per_transaction_value_minor', 'daily_milliliters', 'daily_value_minor',
            'weekly_milliliters', 'weekly_value_minor', 'monthly_milliliters', 'monthly_value_minor', 'daily_transaction_count',
        ];
        $result = [];
        foreach ($keys as $key) {
            $result[$key] = array_key_exists($key, $attributes) ? $attributes[$key] : $card?->{$key};
        }

        return $result;
    }

    private function assertLimits(array $attributes, ?FuelCard $card = null): void
    {
        foreach ($this->limits($attributes, $card) as $key => $value) {
            if ($value !== null && (! is_int($value) || $value <= 0)) {
                throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً أو null لتعطيل الحد.");
            }
        }
    }

    private function timeWindows(mixed $windows): ?array
    {
        if ($windows === null) {
            return null;
        }
        if (! is_array($windows) || ! array_is_list($windows)) {
            throw new RuntimeException('نوافذ وقت البطاقة يجب أن تكون قائمة.');
        }
        foreach ($windows as $window) {
            if (! is_array($window) || ! isset($window['start'], $window['end'], $window['days'])
                || ! is_string($window['start']) || ! is_string($window['end']) || ! is_array($window['days'])
                || ! preg_match('/^([01]\\d|2[0-3]):[0-5]\\d$/', $window['start'])
                || ! preg_match('/^([01]\\d|2[0-3]):[0-5]\\d$/', $window['end'])
                || ! array_is_list($window['days']) || $window['days'] === []
                || count($window['days']) !== count(array_unique($window['days']))) {
                throw new RuntimeException('كل نافذة وقت تحتاج start/end بصيغة HH:MM وأيام ISO فريدة.');
            }
            foreach ($window['days'] as $day) {
                if (! is_int($day) || $day < 1 || $day > 7) {
                    throw new RuntimeException('أيام نافذة البطاقة يجب أن تكون ISO من 1 إلى 7.');
                }
            }
        }

        return $windows;
    }

    private function assertStatus(mixed $status): void
    {
        if (! is_string($status) || ! in_array($status, FuelCard::STATUSES, true)) {
            throw new RuntimeException('حالة بطاقة الوقود غير صالحة.');
        }
    }

    private function assertDateRange(CarbonInterface $from, ?CarbonInterface $until): void
    {
        if ($until !== null && $until->lte($from)) {
            throw new RuntimeException('نهاية فعالية بطاقة الوقود يجب أن تكون بعد البداية حصراً.');
        }
    }

    private function requiredText(array $attributes, string $key): string
    {
        $value = trim((string) ($attributes[$key] ?? ''));
        if ($value === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return $value;
    }

    private function nullableText(mixed $value): ?string
    {
        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }

    private function date(mixed $value): Carbon
    {
        return Carbon::parse($value);
    }

    private function nullableDate(mixed $value): ?Carbon
    {
        return $value === null || $value === '' ? null : Carbon::parse($value);
    }

    private function audit(object $subject, string $action, ?array $before, ?array $after, User $actor, ?string $reason): void
    {
        CorporateFuelAuditEvent::create([
            'subject_type' => $subject::class,
            'subject_id' => $subject->id,
            'action' => $action,
            'before' => $before,
            'after' => $after,
            'changed_by' => $actor->id,
            'reason' => $reason,
            'changed_at' => now(),
        ]);
    }

    private function snapshot(FuelCard $card): array
    {
        return $card->only([
            'id', 'public_identifier', 'partner_id', 'corporate_fuel_contract_id', 'fuel_fleet_vehicle_id',
            'fuel_fleet_driver_id', 'status', 'effective_from', 'effective_until', 'per_transaction_milliliters',
            'per_transaction_value_minor', 'daily_milliliters', 'daily_value_minor', 'weekly_milliliters',
            'weekly_value_minor', 'monthly_milliliters', 'monthly_value_minor', 'daily_transaction_count',
            'station_restriction_mode', 'fuel_restriction_mode', 'allowed_time_windows', 'replaces_fuel_card_id',
        ]);
    }
}
