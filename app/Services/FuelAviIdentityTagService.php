<?php

namespace App\Services;

use App\Models\CorporateFuelAuditEvent;
use App\Models\CorporateFuelContract;
use App\Models\FuelAviIdentityTag;
use App\Models\FuelCard;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Models\Partner;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * إدارة هوية AVI/RFID الإدارية. القيمة الخام للوسم تستخدم لحظة الإنشاء أو
 * التفويض فقط؛ لا تُخزن ولا تظهر في مورد أو سجل تدقيق.
 */
class FuelAviIdentityTagService
{
    public function create(array $attributes, User $actor): FuelAviIdentityTag
    {
        try {
            return DB::transaction(function () use ($attributes, $actor) {
            [$partner, $contract] = $this->partnerAndContract($attributes);
            [$vehicle, $driver] = $this->identityTarget($attributes, $partner, $contract);
            $from = $this->date($attributes['effective_from'] ?? now());
            $until = $this->nullableDate($attributes['effective_until'] ?? null);
            $this->assertDateRange($from, $until);
            $this->assertStatus($attributes['status'] ?? FuelAviIdentityTag::STATUS_ACTIVE);
            $card = $this->card($attributes['fuel_card_id'] ?? null, $partner, $contract, $vehicle, $driver);
            $replaces = $this->replacement($attributes['replaces_fuel_avi_identity_tag_id'] ?? null, $partner, $contract, $vehicle, $driver);

            $tag = FuelAviIdentityTag::create([
                'public_identifier' => $this->requiredText($attributes, 'public_identifier'),
                'credential_hash' => $this->credentialHash($attributes),
                'identity_type' => $this->identityType($attributes),
                'partner_id' => $partner->id,
                'corporate_fuel_contract_id' => $contract->id,
                'fuel_card_id' => $card?->id,
                'fuel_fleet_vehicle_id' => $vehicle?->id,
                'fuel_fleet_driver_id' => $driver?->id,
                'status' => $attributes['status'] ?? FuelAviIdentityTag::STATUS_ACTIVE,
                'effective_from' => $from,
                'effective_until' => $until,
                'replaces_fuel_avi_identity_tag_id' => $replaces?->id,
                'created_by' => $actor->id,
            ]);
            $this->audit($tag, 'avi_identity_tag_created', null, $this->snapshot($tag), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $tag->fresh($this->relations());
            });
        } catch (QueryException $exception) {
            // الحارس الفريد النهائي يحمي السباقات؛ لا نعيد hash أو قيمة الاعتماد
            // ولا نص SQL إلى المستخدم.
            throw new RuntimeException('AVI_IDENTITY_TAG_ALREADY_REGISTERED', previous: $exception);
        }
    }

    /** يسمح بالتعديل المقصود للحالة أو الفعالية فقط؛ الهوية والارتباطات ثابتة. */
    public function update(FuelAviIdentityTag $tag, array $attributes, User $actor): FuelAviIdentityTag
    {
        return DB::transaction(function () use ($tag, $attributes, $actor) {
            $tag = FuelAviIdentityTag::lockForUpdate()->findOrFail($tag->id);
            $before = $this->snapshot($tag);
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status']);
            }
            $from = array_key_exists('effective_from', $attributes) ? $this->date($attributes['effective_from']) : $tag->effective_from;
            $until = array_key_exists('effective_until', $attributes) ? $this->nullableDate($attributes['effective_until']) : $tag->effective_until;
            $this->assertDateRange($from, $until);

            $tag->update([
                'status' => $attributes['status'] ?? $tag->status,
                'effective_from' => $from,
                'effective_until' => $until,
            ]);
            $tag = $tag->fresh($this->relations());
            $this->audit($tag, 'avi_identity_tag_updated', $before, $this->snapshot($tag), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $tag;
        });
    }

    /** يستبدل الوسم بهوية خام جديدة من دون نسخ credential أو تغيير التاريخ. */
    public function replace(FuelAviIdentityTag $tag, array $attributes, User $actor): FuelAviIdentityTag
    {
        return DB::transaction(function () use ($tag, $attributes, $actor) {
            $tag = FuelAviIdentityTag::lockForUpdate()->findOrFail($tag->id);
            if (! in_array($tag->status, [
                FuelAviIdentityTag::STATUS_ACTIVE,
                FuelAviIdentityTag::STATUS_SUSPENDED,
                FuelAviIdentityTag::STATUS_LOST,
                FuelAviIdentityTag::STATUS_BLACKLISTED,
            ], true)) {
                throw new RuntimeException('لا يمكن استبدال وسم ملغى أو مستبدل أو منتهي.');
            }

            $before = $this->snapshot($tag);
            $tag->update(['status' => FuelAviIdentityTag::STATUS_REPLACED]);
            $this->audit($tag, 'avi_identity_tag_replaced', $before, $this->snapshot($tag), $actor, $this->nullableText($attributes['reason'] ?? null));

            $attributes['identity_type'] = $tag->identity_type;
            $attributes['partner_id'] = $tag->partner_id;
            $attributes['corporate_fuel_contract_id'] = $tag->corporate_fuel_contract_id;
            $attributes['fuel_card_id'] = array_key_exists('fuel_card_id', $attributes) ? $attributes['fuel_card_id'] : $tag->fuel_card_id;
            $attributes['fuel_fleet_vehicle_id'] = $tag->fuel_fleet_vehicle_id;
            $attributes['fuel_fleet_driver_id'] = $tag->fuel_fleet_driver_id;
            $attributes['replaces_fuel_avi_identity_tag_id'] = $tag->id;
            $attributes['status'] = FuelAviIdentityTag::STATUS_ACTIVE;

            return $this->create($attributes, $actor);
        });
    }

    public function findActiveByCredential(string $credential, CarbonInterface $at): ?FuelAviIdentityTag
    {
        return FuelAviIdentityTag::where('credential_hash', hash('sha256', trim($credential)))
            ->where('status', FuelAviIdentityTag::STATUS_ACTIVE)
            ->where('effective_from', '<=', $at)
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>', $at))
            ->first();
    }

    private function partnerAndContract(array $attributes): array
    {
        $partner = Partner::find($this->requiredText($attributes, 'partner_id'));
        if ($partner === null || ! $partner->isCustomer() || ! $partner->is_active) {
            throw new RuntimeException('وسم AVI/RFID يتطلب عميلاً نشطاً من المستأجر الحالي.');
        }
        $contract = CorporateFuelContract::find($this->requiredText($attributes, 'corporate_fuel_contract_id'));
        if ($contract === null || $contract->partner_id !== $partner->id) {
            throw new RuntimeException('عقد وسم AVI/RFID لا يخص العميل المحدد أو لا ينتمي إلى المستأجر.');
        }

        return [$partner, $contract];
    }

    private function identityTarget(array $attributes, Partner $partner, CorporateFuelContract $contract): array
    {
        $type = $this->identityType($attributes);
        $vehicle = null;
        $driver = null;
        if (in_array($type, FuelAviIdentityTag::VEHICLE_IDENTITY_TYPES, true)) {
            $vehicle = FuelFleetVehicle::find($this->requiredText($attributes, 'fuel_fleet_vehicle_id'));
            if ($vehicle === null || ($vehicle->partner_id !== null && $vehicle->partner_id !== $partner->id)
                || ($vehicle->corporate_fuel_contract_id !== null && $vehicle->corporate_fuel_contract_id !== $contract->id)) {
                throw new RuntimeException('مركبة وسم AVI/RFID لا تخص العميل أو العقد الحالي.');
            }
            if (($attributes['fuel_fleet_driver_id'] ?? null) !== null) {
                throw new RuntimeException('وسم هوية المركبة لا يربط سائقاً؛ أنشئ هوية سائق مستقلة.');
            }
        } else {
            $driver = FuelFleetDriver::find($this->requiredText($attributes, 'fuel_fleet_driver_id'));
            if ($driver === null || ($driver->partner_id !== null && $driver->partner_id !== $partner->id)
                || ($driver->corporate_fuel_contract_id !== null && $driver->corporate_fuel_contract_id !== $contract->id)) {
                throw new RuntimeException('سائق وسم AVI/RFID لا يخص العميل أو العقد الحالي.');
            }
            if (($attributes['fuel_fleet_vehicle_id'] ?? null) !== null) {
                throw new RuntimeException('وسم هوية السائق لا يربط مركبة؛ أنشئ هوية مركبة مستقلة.');
            }
        }

        return [$vehicle, $driver];
    }

    private function card(mixed $id, Partner $partner, CorporateFuelContract $contract, ?FuelFleetVehicle $vehicle, ?FuelFleetDriver $driver): ?FuelCard
    {
        if ($id === null || $id === '') {
            return null;
        }
        $card = FuelCard::find($id);
        if ($card === null || $card->partner_id !== $partner->id || $card->corporate_fuel_contract_id !== $contract->id
            || ($card->fuel_fleet_vehicle_id !== null && $card->fuel_fleet_vehicle_id !== $vehicle?->id)
            || ($card->fuel_fleet_driver_id !== null && $card->fuel_fleet_driver_id !== $driver?->id)) {
            throw new RuntimeException('بطاقة وسم AVI/RFID لا تطابق العميل أو العقد أو هدف الهوية.');
        }

        return $card;
    }

    private function replacement(mixed $id, Partner $partner, CorporateFuelContract $contract, ?FuelFleetVehicle $vehicle, ?FuelFleetDriver $driver): ?FuelAviIdentityTag
    {
        if ($id === null || $id === '') {
            return null;
        }
        $tag = FuelAviIdentityTag::lockForUpdate()->find($id);
        if ($tag === null || $tag->partner_id !== $partner->id || $tag->corporate_fuel_contract_id !== $contract->id
            || $tag->fuel_fleet_vehicle_id !== $vehicle?->id || $tag->fuel_fleet_driver_id !== $driver?->id) {
            throw new RuntimeException('الوسم المستبدل لا يطابق العميل أو العقد أو هدف الهوية.');
        }

        return $tag;
    }

    private function identityType(array $attributes): string
    {
        $type = $attributes['identity_type'] ?? null;
        if (! is_string($type) || ! in_array($type, FuelAviIdentityTag::IDENTITY_TYPES, true)) {
            throw new RuntimeException('نوع هوية AVI/RFID غير صالح.');
        }

        return $type;
    }

    private function credentialHash(array $attributes): string
    {
        return hash('sha256', $this->requiredText($attributes, 'credential'));
    }

    private function assertStatus(mixed $status): void
    {
        if (! is_string($status) || ! in_array($status, FuelAviIdentityTag::STATUSES, true)) {
            throw new RuntimeException('حالة وسم AVI/RFID غير صالحة.');
        }
    }

    private function assertDateRange(CarbonInterface $from, ?CarbonInterface $until): void
    {
        if ($until !== null && $until->lte($from)) {
            throw new RuntimeException('نهاية فعالية وسم AVI/RFID يجب أن تكون بعد البداية حصراً.');
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

    private function audit(FuelAviIdentityTag $tag, string $action, ?array $before, ?array $after, User $actor, ?string $reason): void
    {
        CorporateFuelAuditEvent::create([
            'subject_type' => $tag::class,
            'subject_id' => $tag->id,
            'action' => $action,
            'before' => $before,
            'after' => $after,
            'changed_by' => $actor->id,
            'reason' => $reason,
            'changed_at' => now(),
        ]);
    }

    private function snapshot(FuelAviIdentityTag $tag): array
    {
        return $tag->only([
            'id', 'public_identifier', 'identity_type', 'partner_id', 'corporate_fuel_contract_id',
            'fuel_card_id', 'fuel_fleet_vehicle_id', 'fuel_fleet_driver_id', 'status',
            'effective_from', 'effective_until', 'replaces_fuel_avi_identity_tag_id',
        ]);
    }

    /** @return list<string> */
    private function relations(): array
    {
        return ['partner', 'contract', 'fuelCard', 'vehicle', 'driver', 'replacedTag'];
    }
}
