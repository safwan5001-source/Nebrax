<?php

namespace App\Services;

use App\Models\CorporateFuelAuditEvent;
use App\Models\CorporateFuelContract;
use App\Models\Employee;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetDriverVehicle;
use App\Models\FuelFleetVehicle;
use App\Models\FuelFleetVehicleProduct;
use App\Models\FuelProduct;
use App\Models\FuelVehicleOdometerReading;
use App\Models\Partner;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** إدارة بيانات أسطول Cycle 6؛ لا تملك هذه الخدمة أثر AR أو مخزون أو فاتورة. */
class FuelFleetService
{
    public function createVehicle(array $attributes, User $actor): FuelFleetVehicle
    {
        return DB::transaction(function () use ($attributes, $actor) {
            [$partner, $contract] = $this->ownership($attributes['partner_id'] ?? null, $attributes['corporate_fuel_contract_id'] ?? null);
            $plate = $this->requiredText($attributes, 'plate_number');
            $country = $this->nullableText($attributes['plate_country'] ?? null);
            $this->assertStatus($attributes['status'] ?? FuelFleetVehicle::STATUS_ACTIVE, FuelFleetVehicle::STATUSES, 'حالة المركبة');
            $this->assertNonNegative($attributes['tank_capacity_milliliters'] ?? null, 'سعة خزان المركبة');
            $this->assertNonNegative($attributes['odometer'] ?? null, 'عداد المركبة');

            $vehicle = FuelFleetVehicle::create([
                'partner_id' => $partner?->id,
                'corporate_fuel_contract_id' => $contract?->id,
                'plate_number' => $plate,
                'plate_country' => $country,
                'vin' => $this->nullableText($attributes['vin'] ?? null),
                'fleet_number' => $this->nullableText($attributes['fleet_number'] ?? null),
                'fuel_type' => $this->nullableText($attributes['fuel_type'] ?? null),
                'tank_capacity_milliliters' => $attributes['tank_capacity_milliliters'] ?? null,
                'odometer' => $attributes['odometer'] ?? null,
                'status' => $attributes['status'] ?? FuelFleetVehicle::STATUS_ACTIVE,
                'created_by' => $actor->id,
            ]);
            $this->replaceVehicleProducts($vehicle, $attributes['fuel_product_ids'] ?? []);
            $this->audit($vehicle, 'vehicle_created', null, $this->vehicleSnapshot($vehicle), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $vehicle->fresh('allowedFuelProducts');
        });
    }

    public function updateVehicle(FuelFleetVehicle $vehicle, array $attributes, User $actor): FuelFleetVehicle
    {
        return DB::transaction(function () use ($vehicle, $attributes, $actor) {
            $vehicle = FuelFleetVehicle::lockForUpdate()->findOrFail($vehicle->id);
            $before = $this->vehicleSnapshot($vehicle);
            [$partner, $contract] = $this->ownership(
                array_key_exists('partner_id', $attributes) ? $attributes['partner_id'] : $vehicle->partner_id,
                array_key_exists('corporate_fuel_contract_id', $attributes) ? $attributes['corporate_fuel_contract_id'] : $vehicle->corporate_fuel_contract_id,
            );
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status'], FuelFleetVehicle::STATUSES, 'حالة المركبة');
            }
            foreach (['tank_capacity_milliliters' => 'سعة خزان المركبة', 'odometer' => 'عداد المركبة'] as $key => $label) {
                if (array_key_exists($key, $attributes)) {
                    $this->assertNonNegative($attributes[$key], $label);
                }
            }
            if (array_key_exists('odometer', $attributes) && $attributes['odometer'] !== null && (int) $attributes['odometer'] < (int) ($vehicle->odometer ?? 0)) {
                throw new RuntimeException('لا يمكن خفض عداد المركبة بتعديل مباشر؛ استخدم workflow تصحيح مدقق.');
            }

            $vehicle->update([
                'partner_id' => $partner?->id,
                'corporate_fuel_contract_id' => $contract?->id,
                'plate_number' => array_key_exists('plate_number', $attributes) ? $this->requiredText($attributes, 'plate_number') : $vehicle->plate_number,
                'plate_country' => array_key_exists('plate_country', $attributes) ? $this->nullableText($attributes['plate_country']) : $vehicle->plate_country,
                'vin' => array_key_exists('vin', $attributes) ? $this->nullableText($attributes['vin']) : $vehicle->vin,
                'fleet_number' => array_key_exists('fleet_number', $attributes) ? $this->nullableText($attributes['fleet_number']) : $vehicle->fleet_number,
                'fuel_type' => array_key_exists('fuel_type', $attributes) ? $this->nullableText($attributes['fuel_type']) : $vehicle->fuel_type,
                'tank_capacity_milliliters' => array_key_exists('tank_capacity_milliliters', $attributes) ? $attributes['tank_capacity_milliliters'] : $vehicle->tank_capacity_milliliters,
                'odometer' => array_key_exists('odometer', $attributes) ? $attributes['odometer'] : $vehicle->odometer,
                'status' => $attributes['status'] ?? $vehicle->status,
            ]);
            if (array_key_exists('fuel_product_ids', $attributes)) {
                $this->replaceVehicleProducts($vehicle, $attributes['fuel_product_ids']);
            }
            $vehicle = $vehicle->fresh('allowedFuelProducts');
            $this->audit($vehicle, 'vehicle_updated', $before, $this->vehicleSnapshot($vehicle), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $vehicle;
        });
    }

    public function createDriver(array $attributes, User $actor): FuelFleetDriver
    {
        return DB::transaction(function () use ($attributes, $actor) {
            [$partner, $contract] = $this->ownership($attributes['partner_id'] ?? null, $attributes['corporate_fuel_contract_id'] ?? null);
            $employee = null;
            if (($employeeId = $attributes['employee_id'] ?? null) !== null) {
                $employee = Employee::find($employeeId);
                if ($employee === null) {
                    throw new RuntimeException('الموظف المرتبط بالسائق غير موجود أو لا ينتمي إلى المستأجر النشط.');
                }
            }
            $this->assertStatus($attributes['status'] ?? FuelFleetDriver::STATUS_ACTIVE, FuelFleetDriver::STATUSES, 'حالة السائق');
            $driver = FuelFleetDriver::create([
                'partner_id' => $partner?->id,
                'corporate_fuel_contract_id' => $contract?->id,
                'employee_id' => $employee?->id,
                'name' => $this->requiredText($attributes, 'name'),
                'identifier' => $this->nullableText($attributes['identifier'] ?? null),
                'mobile' => $this->nullableText($attributes['mobile'] ?? null),
                'status' => $attributes['status'] ?? FuelFleetDriver::STATUS_ACTIVE,
                'created_by' => $actor->id,
            ]);
            $this->audit($driver, 'driver_created', null, $this->driverSnapshot($driver), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $driver;
        });
    }

    public function updateDriver(FuelFleetDriver $driver, array $attributes, User $actor): FuelFleetDriver
    {
        return DB::transaction(function () use ($driver, $attributes, $actor) {
            $driver = FuelFleetDriver::lockForUpdate()->findOrFail($driver->id);
            $before = $this->driverSnapshot($driver);
            [$partner, $contract] = $this->ownership(
                array_key_exists('partner_id', $attributes) ? $attributes['partner_id'] : $driver->partner_id,
                array_key_exists('corporate_fuel_contract_id', $attributes) ? $attributes['corporate_fuel_contract_id'] : $driver->corporate_fuel_contract_id,
            );
            $employee = $driver->employee_id === null ? null : Employee::find($driver->employee_id);
            if (array_key_exists('employee_id', $attributes)) {
                $employee = $attributes['employee_id'] === null ? null : Employee::find($attributes['employee_id']);
                if ($attributes['employee_id'] !== null && $employee === null) {
                    throw new RuntimeException('الموظف المرتبط بالسائق غير موجود أو لا ينتمي إلى المستأجر النشط.');
                }
            }
            if (array_key_exists('status', $attributes)) {
                $this->assertStatus($attributes['status'], FuelFleetDriver::STATUSES, 'حالة السائق');
            }
            $driver->update([
                'partner_id' => $partner?->id,
                'corporate_fuel_contract_id' => $contract?->id,
                'employee_id' => $employee?->id,
                'name' => array_key_exists('name', $attributes) ? $this->requiredText($attributes, 'name') : $driver->name,
                'identifier' => array_key_exists('identifier', $attributes) ? $this->nullableText($attributes['identifier']) : $driver->identifier,
                'mobile' => array_key_exists('mobile', $attributes) ? $this->nullableText($attributes['mobile']) : $driver->mobile,
                'status' => $attributes['status'] ?? $driver->status,
            ]);
            $driver = $driver->fresh();
            $this->audit($driver, 'driver_updated', $before, $this->driverSnapshot($driver), $actor, $this->nullableText($attributes['reason'] ?? null));

            return $driver;
        });
    }

    public function assignDriverVehicle(FuelFleetDriver $driver, FuelFleetVehicle $vehicle, User $actor, ?string $reason = null): FuelFleetDriverVehicle
    {
        return DB::transaction(function () use ($driver, $vehicle, $actor, $reason) {
            $driver = FuelFleetDriver::lockForUpdate()->findOrFail($driver->id);
            $vehicle = FuelFleetVehicle::lockForUpdate()->findOrFail($vehicle->id);
            $this->assertMatchingOwnership($driver->partner_id, $driver->corporate_fuel_contract_id, $vehicle->partner_id, $vehicle->corporate_fuel_contract_id, 'السائق والمركبة');
            $assignment = FuelFleetDriverVehicle::firstOrCreate([
                'fuel_fleet_driver_id' => $driver->id,
                'fuel_fleet_vehicle_id' => $vehicle->id,
            ]);
            $this->audit($assignment, 'driver_vehicle_assigned', null, ['driver_id' => $driver->id, 'vehicle_id' => $vehicle->id], $actor, $this->nullableText($reason));

            return $assignment;
        });
    }

    public function recordOdometer(FuelFleetVehicle $vehicle, int $odometer, ?string $fuelSaleId, User $actor): FuelVehicleOdometerReading
    {
        if ($odometer < 0) {
            throw new RuntimeException('قراءة العداد يجب أن تكون عدداً صحيحاً غير سالب.');
        }

        return DB::transaction(function () use ($vehicle, $odometer, $fuelSaleId, $actor) {
            $vehicle = FuelFleetVehicle::lockForUpdate()->findOrFail($vehicle->id);
            $last = FuelVehicleOdometerReading::where('fuel_fleet_vehicle_id', $vehicle->id)
                ->orderByDesc('recorded_at')->lockForUpdate()->first();
            $baseline = max((int) ($vehicle->odometer ?? 0), (int) ($last?->odometer ?? 0));
            if ($odometer < $baseline) {
                throw new RuntimeException('قراءة العداد أقل من آخر قراءة معتمدة؛ يلزم workflow تصحيح مدقق.');
            }
            $reading = FuelVehicleOdometerReading::create([
                'fuel_fleet_vehicle_id' => $vehicle->id,
                'fuel_sale_id' => $fuelSaleId,
                'odometer' => $odometer,
                'source' => 'fuel_sale',
                'recorded_by' => $actor->id,
                'recorded_at' => now(),
            ]);
            $vehicle->update(['odometer' => $odometer]);
            $this->audit($reading, 'odometer_recorded', null, ['vehicle_id' => $vehicle->id, 'odometer' => $odometer, 'fuel_sale_id' => $fuelSaleId], $actor, null);

            return $reading;
        });
    }

    private function replaceVehicleProducts(FuelFleetVehicle $vehicle, array $ids): void
    {
        if (! array_is_list($ids) || count($ids) !== count(array_unique($ids))) {
            throw new RuntimeException('منتجات وقود المركبة يجب أن تكون قائمة معرفات فريدة.');
        }
        FuelFleetVehicleProduct::where('fuel_fleet_vehicle_id', $vehicle->id)->delete();
        foreach ($ids as $id) {
            $fuelProduct = FuelProduct::find($id);
            if ($fuelProduct === null) {
                throw new RuntimeException('منتج وقود المركبة غير موجود أو لا ينتمي إلى المستأجر النشط.');
            }
            FuelFleetVehicleProduct::create(['fuel_fleet_vehicle_id' => $vehicle->id, 'fuel_product_id' => $fuelProduct->id]);
        }
    }

    /** @return array{0:?Partner,1:?CorporateFuelContract} */
    private function ownership(?string $partnerId, ?string $contractId): array
    {
        $partner = $partnerId === null ? null : Partner::find($partnerId);
        if ($partnerId !== null && ($partner === null || ! $partner->isCustomer())) {
            throw new RuntimeException('عميل الأسطول غير موجود أو لا ينتمي إلى المستأجر النشط.');
        }
        $contract = $contractId === null ? null : CorporateFuelContract::find($contractId);
        if ($contractId !== null && $contract === null) {
            throw new RuntimeException('عقد أسطول المركبة أو السائق غير موجود أو لا ينتمي إلى المستأجر النشط.');
        }
        if ($contract !== null && $partner !== null && $contract->partner_id !== $partner->id) {
            throw new RuntimeException('عقد الأسطول لا يخص العميل المحدد.');
        }
        if ($contract !== null && $partner === null) {
            $partner = Partner::findOrFail($contract->partner_id);
        }

        return [$partner, $contract];
    }

    private function assertMatchingOwnership(?string $leftPartner, ?string $leftContract, ?string $rightPartner, ?string $rightContract, string $label): void
    {
        if (($leftPartner !== null && $rightPartner !== null && $leftPartner !== $rightPartner)
            || ($leftContract !== null && $rightContract !== null && $leftContract !== $rightContract)) {
            throw new RuntimeException("{$label} لا يخصان العميل أو العقد نفسه.");
        }
    }

    private function assertStatus(mixed $value, array $allowed, string $label): void
    {
        if (! is_string($value) || ! in_array($value, $allowed, true)) {
            throw new RuntimeException("{$label} غير صالحة.");
        }
    }

    private function assertNonNegative(mixed $value, string $label): void
    {
        if ($value !== null && (! is_int($value) || $value < 0)) {
            throw new RuntimeException("{$label} يجب أن تكون عدداً صحيحاً غير سالب.");
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

    private function vehicleSnapshot(FuelFleetVehicle $vehicle): array
    {
        return $vehicle->only(['id', 'partner_id', 'corporate_fuel_contract_id', 'plate_number', 'plate_country', 'vin', 'fleet_number', 'fuel_type', 'tank_capacity_milliliters', 'odometer', 'status']);
    }

    private function driverSnapshot(FuelFleetDriver $driver): array
    {
        return $driver->only(['id', 'partner_id', 'corporate_fuel_contract_id', 'employee_id', 'name', 'identifier', 'mobile', 'status']);
    }
}
