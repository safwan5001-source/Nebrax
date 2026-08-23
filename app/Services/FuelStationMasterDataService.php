<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\User;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * حدود Cycle 1 للبيانات المرجعية لمحطات الوقود.
 *
 * لا تسجل هذه الخدمة حركة مخزون أو قراءة فعلية أو بيعاً أو دفعة أو قيداً؛ هي فقط
 * تحمي تطابق المراجع التنظيمية التي ستعتمد عليها الدورات اللاحقة.
 */
class FuelStationMasterDataService
{
    /** @param array<string, mixed> $data */
    public function createStation(array $data): FuelStation
    {
        return DB::transaction(function () use ($data) {
            $branch = $this->branch($data['branch_id']);
            $this->assertStationReferences($data);
            $this->assertStationCodeAvailable($data['code']);

            return FuelStation::create([
                ...$this->stationAttributes($data),
                'branch_id' => $branch->id,
            ]);
        });
    }

    /** @param array<string, mixed> $data */
    public function updateStation(FuelStation $station, array $data): FuelStation
    {
        return DB::transaction(function () use ($station, $data) {
            $station = FuelStation::lockForUpdate()->findOrFail($station->id);
            $next = $this->merged($station, $data, [...array_keys($this->stationAttributes($data)), 'branch_id']);
            $branch = $this->branch($next['branch_id']);
            $this->assertStationReferences($next);
            $this->assertStationCodeAvailable($next['code'], $station->id);

            if ($branch->id !== $station->branch_id && ($station->tanks()->exists() || $station->pumps()->exists())) {
                throw new RuntimeException('لا يمكن تغيير فرع محطة لها خزانات أو مضخات مسجلة. أنشئ محطة جديدة أو انقل البنية بتدفق مخصص.');
            }

            $station->update([...$this->stationAttributes($next), 'branch_id' => $branch->id]);

            return $station->fresh($this->stationRelations());
        });
    }

    public function deleteStation(FuelStation $station): void
    {
        if ($station->tanks()->exists() || $station->pumps()->exists() || $station->integrationEvents()->exists()) {
            throw new RuntimeException('لا يمكن حذف محطة لها بنية ساحة أو سجل تكامل. عطّلها للاحتفاظ بالأثر التشغيلي.');
        }

        $station->delete();
    }

    /** @param array<string, mixed> $data */
    public function createFuelProduct(array $data): FuelProduct
    {
        return DB::transaction(function () use ($data) {
            $product = $this->product($data['product_id']);
            $this->assertFuelProductCodeAvailable($data['code']);

            return FuelProduct::create([
                'product_id' => $product->id,
                'code' => trim($data['code']),
                'name' => trim($data['name']),
                'density_kg_per_m3' => $this->nullableInt($data['density_kg_per_m3'] ?? null),
                'tax_category' => $this->nullableTrim($data['tax_category'] ?? null),
                'is_active' => $data['is_active'] ?? true,
            ]);
        });
    }

    /** @param array<string, mixed> $data */
    public function updateFuelProduct(FuelProduct $fuelProduct, array $data): FuelProduct
    {
        return DB::transaction(function () use ($fuelProduct, $data) {
            $fuelProduct = FuelProduct::lockForUpdate()->findOrFail($fuelProduct->id);
            $nextProductId = array_key_exists('product_id', $data) ? $data['product_id'] : $fuelProduct->product_id;
            $nextCode = array_key_exists('code', $data) ? trim($data['code']) : $fuelProduct->code;
            $this->product($nextProductId);
            $this->assertFuelProductCodeAvailable($nextCode, $fuelProduct->id);

            if ($nextProductId !== $fuelProduct->product_id && ($fuelProduct->tanks()->exists() || $fuelProduct->nozzles()->exists())) {
                throw new RuntimeException('لا يمكن تغيير منتج الوقود بعد ربطه بخزان أو فوهة. أنشئ مواصفة وقود جديدة.');
            }

            $fuelProduct->update([
                'product_id' => $nextProductId,
                'code' => $nextCode,
                'name' => array_key_exists('name', $data) ? trim($data['name']) : $fuelProduct->name,
                'density_kg_per_m3' => array_key_exists('density_kg_per_m3', $data) ? $this->nullableInt($data['density_kg_per_m3']) : $fuelProduct->density_kg_per_m3,
                'tax_category' => array_key_exists('tax_category', $data) ? $this->nullableTrim($data['tax_category']) : $fuelProduct->tax_category,
                'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : $fuelProduct->is_active,
            ]);

            return $fuelProduct->fresh('product');
        });
    }

    public function deleteFuelProduct(FuelProduct $fuelProduct): void
    {
        if ($fuelProduct->tanks()->exists() || $fuelProduct->nozzles()->exists()) {
            throw new RuntimeException('لا يمكن حذف منتج وقود مرتبط بخزان أو فوهة. عطّله للحفاظ على الخرائط.');
        }

        $fuelProduct->delete();
    }

    /** @param array<string, mixed> $data */
    public function createTank(array $data): FuelTank
    {
        return DB::transaction(function () use ($data) {
            $station = $this->station($data['fuel_station_id']);
            $fuelProduct = $this->fuelProduct($data['fuel_product_id']);
            $attributes = $this->tankAttributes($data, $station, $fuelProduct);
            $this->assertTankCodeAvailable($station, $attributes['code']);
            $this->assertAtgKeyAvailable($attributes['atg_source_key']);

            $tank = FuelTank::create($attributes);
            $this->syncCalibration($tank, $data['calibration_points'] ?? []);

            return $tank->fresh('calibrationPoints');
        });
    }

    /** @param array<string, mixed> $data */
    public function updateTank(FuelTank $tank, array $data): FuelTank
    {
        return DB::transaction(function () use ($tank, $data) {
            $tank = FuelTank::lockForUpdate()->findOrFail($tank->id);
            $next = $this->merged($tank, $data, [
                'fuel_station_id', 'fuel_product_id', 'code', 'name', 'capacity_milliliters',
                'safe_capacity_milliliters', 'minimum_level_milliliters', 'dead_stock_milliliters',
                'opening_volume_milliliters', 'measurement_configuration', 'atg_source_key', 'status',
            ]);
            $station = $this->station($next['fuel_station_id']);
            $fuelProduct = $this->fuelProduct($next['fuel_product_id']);
            $attributes = $this->tankAttributes($next, $station, $fuelProduct);
            $this->assertTankCodeAvailable($station, $attributes['code'], $tank->id);
            $this->assertAtgKeyAvailable($attributes['atg_source_key'], $tank->id);

            if (($station->id !== $tank->fuel_station_id || $fuelProduct->id !== $tank->fuel_product_id) && $tank->nozzles()->exists()) {
                throw new RuntimeException('لا يمكن تغيير محطة الخزان أو منتجه بعد ربط فوهات به. عدّل الخرائط التابعة أولاً.');
            }

            $tank->update($attributes);
            if (array_key_exists('calibration_points', $data)) {
                $this->syncCalibration($tank, $data['calibration_points'] ?? []);
            }

            return $tank->fresh('calibrationPoints');
        });
    }

    public function deleteTank(FuelTank $tank): void
    {
        if ($tank->nozzles()->exists()) {
            throw new RuntimeException('لا يمكن حذف خزان مرتبط بفوهة. أزل خريطة الفوهة أولاً.');
        }

        $tank->delete();
    }

    /** @param array<string, mixed> $data */
    public function createPump(array $data): FuelPump
    {
        return DB::transaction(function () use ($data) {
            $station = $this->station($data['fuel_station_id']);
            $attributes = $this->pumpAttributes($data, $station);
            $this->assertPumpNumberAvailable($station, $attributes['pump_number']);
            $this->assertControllerKeyAvailable(FuelPump::class, $attributes['controller_key']);

            return FuelPump::create($attributes);
        });
    }

    /** @param array<string, mixed> $data */
    public function updatePump(FuelPump $pump, array $data): FuelPump
    {
        return DB::transaction(function () use ($pump, $data) {
            $pump = FuelPump::lockForUpdate()->findOrFail($pump->id);
            $next = $this->merged($pump, $data, ['fuel_station_id', 'pump_number', 'name', 'controller_key', 'status']);
            $station = $this->station($next['fuel_station_id']);
            $attributes = $this->pumpAttributes($next, $station);
            $this->assertPumpNumberAvailable($station, $attributes['pump_number'], $pump->id);
            $this->assertControllerKeyAvailable(FuelPump::class, $attributes['controller_key'], $pump->id);

            if ($station->id !== $pump->fuel_station_id && $pump->nozzles()->exists()) {
                throw new RuntimeException('لا يمكن نقل مضخة لها فوهات إلى محطة أخرى. انقل الخرائط بتدفق مخصص.');
            }

            $pump->update($attributes);

            return $pump->fresh('nozzles');
        });
    }

    public function deletePump(FuelPump $pump): void
    {
        if ($pump->nozzles()->exists()) {
            throw new RuntimeException('لا يمكن حذف مضخة لها فوهات. احذف الفوهات أولاً.');
        }

        $pump->delete();
    }

    /** @param array<string, mixed> $data */
    public function createNozzle(array $data): FuelNozzle
    {
        return DB::transaction(function () use ($data) {
            $attributes = $this->nozzleAttributes($data);
            $this->assertNozzleNumberAvailable($attributes['fuel_pump_id'], $attributes['nozzle_number']);
            $this->assertControllerKeyAvailable(FuelNozzle::class, $attributes['controller_key']);

            return FuelNozzle::create($attributes);
        });
    }

    /** @param array<string, mixed> $data */
    public function updateNozzle(FuelNozzle $nozzle, array $data): FuelNozzle
    {
        return DB::transaction(function () use ($nozzle, $data) {
            $nozzle = FuelNozzle::lockForUpdate()->findOrFail($nozzle->id);
            $next = $this->merged($nozzle, $data, [
                'fuel_pump_id', 'fuel_tank_id', 'fuel_product_id', 'nozzle_number', 'controller_key',
                'meter_opening_milliliters', 'status',
            ]);
            $attributes = $this->nozzleAttributes($next);
            $this->assertNozzleNumberAvailable($attributes['fuel_pump_id'], $attributes['nozzle_number'], $nozzle->id);
            $this->assertControllerKeyAvailable(FuelNozzle::class, $attributes['controller_key'], $nozzle->id);
            $nozzle->update($attributes);

            return $nozzle->fresh(['pump', 'tank', 'fuelProduct']);
        });
    }

    public function deleteNozzle(FuelNozzle $nozzle): void
    {
        $nozzle->delete();
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function stationAttributes(array $data): array
    {
        return [
            'code' => trim($data['code']),
            'name' => trim($data['name']),
            'country_code' => strtoupper($this->nullableTrim($data['country_code'] ?? null) ?? ''),
            'region' => $this->nullableTrim($data['region'] ?? null),
            'city' => $this->nullableTrim($data['city'] ?? null),
            'address' => $this->nullableTrim($data['address'] ?? null),
            'latitude' => $data['latitude'] ?? null,
            'longitude' => $data['longitude'] ?? null,
            'manager_id' => $data['manager_id'] ?? null,
            'status' => $data['status'] ?? FuelStation::STATUS_ACTIVE,
            'timezone' => $this->nullableTrim($data['timezone'] ?? null),
            'operating_day_starts_at' => $this->nullableTrim($data['operating_day_starts_at'] ?? null),
            'operating_hours' => $data['operating_hours'] ?? null,
            'license_number' => $this->nullableTrim($data['license_number'] ?? null),
            'license_expires_at' => $data['license_expires_at'] ?? null,
            'zatca_branch_reference' => $this->nullableTrim($data['zatca_branch_reference'] ?? null),
            'default_inventory_account_id' => $data['default_inventory_account_id'] ?? null,
            'default_revenue_account_id' => $data['default_revenue_account_id'] ?? null,
            'default_cogs_account_id' => $data['default_cogs_account_id'] ?? null,
        ];
    }

    /** @param array<string, mixed> $data */
    private function assertStationReferences(array $data): void
    {
        if (! in_array($data['status'] ?? FuelStation::STATUS_ACTIVE, FuelStation::STATUSES, true)) {
            throw new RuntimeException('حالة المحطة غير صالحة.');
        }
        if (! empty($data['manager_id']) && ! User::whereKey($data['manager_id'])->exists()) {
            throw new RuntimeException('مدير المحطة لا ينتمي إلى المستأجر.');
        }
        $this->assertAccount($data['default_inventory_account_id'] ?? null, 'asset', 'حساب مخزون المحطة');
        $this->assertAccount($data['default_revenue_account_id'] ?? null, 'revenue', 'حساب إيراد المحطة');
        $this->assertAccount($data['default_cogs_account_id'] ?? null, 'expense', 'حساب تكلفة المحطة');
    }

    private function assertAccount(?string $id, string $type, string $label): void
    {
        if ($id !== null && $id !== '' && ! Account::whereKey($id)->where('type', $type)->where('is_group', false)->exists()) {
            throw new RuntimeException("{$label} يجب أن يكون حساباً ورقياً من النوع الصحيح.");
        }
    }

    private function station(string $id): FuelStation
    {
        $station = FuelStation::find($id);
        if (! $station || $station->branch_id === null) {
            throw new RuntimeException('المحطة غير موجودة أو ليس لها ربط فرع تشغيلي صالح.');
        }

        return $station;
    }

    private function branch(string $id): Branch
    {
        $branch = Branch::find($id);
        if (! $branch) {
            throw new RuntimeException('الفرع لا ينتمي إلى المستأجر.');
        }

        return $branch;
    }

    private function product(string $id): Product
    {
        $product = BranchScope::reference(Product::class)->find($id);
        if (! $product || ! $product->is_active) {
            throw new RuntimeException('المنتج غير موجود أو معطّل في نطاق المستأجر.');
        }

        return $product;
    }

    private function fuelProduct(string $id): FuelProduct
    {
        $fuelProduct = FuelProduct::find($id);
        if (! $fuelProduct || ! $fuelProduct->is_active) {
            throw new RuntimeException('منتج الوقود غير موجود أو معطّل.');
        }

        return $fuelProduct;
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function tankAttributes(array $data, FuelStation $station, FuelProduct $fuelProduct): array
    {
        $capacity = $this->positiveInt($data['capacity_milliliters'], 'سعة الخزان');
        $safe = $this->positiveInt($data['safe_capacity_milliliters'], 'السعة الآمنة');
        $minimum = $this->nonNegativeInt($data['minimum_level_milliliters'] ?? 0, 'الحد الأدنى');
        $dead = $this->nonNegativeInt($data['dead_stock_milliliters'] ?? 0, 'الرصيد الميت');
        $opening = $this->nonNegativeInt($data['opening_volume_milliliters'] ?? 0, 'الكمية الافتتاحية');
        if ($safe > $capacity || $minimum > $safe || $dead > $minimum || $opening > $capacity) {
            throw new RuntimeException('حدود الخزان غير متسقة: يجب أن يكون الميت ≤ الأدنى ≤ الآمن ≤ السعة، والافتتاحي ضمن السعة.');
        }
        if (! in_array($data['status'] ?? FuelTank::STATUS_ACTIVE, FuelTank::STATUSES, true)) {
            throw new RuntimeException('حالة الخزان غير صالحة.');
        }

        return [
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuelProduct->id,
            'code' => trim($data['code']),
            'name' => trim($data['name']),
            'capacity_milliliters' => $capacity,
            'safe_capacity_milliliters' => $safe,
            'minimum_level_milliliters' => $minimum,
            'dead_stock_milliliters' => $dead,
            'opening_volume_milliliters' => $opening,
            'measurement_configuration' => $data['measurement_configuration'] ?? null,
            'atg_source_key' => $this->nullableTrim($data['atg_source_key'] ?? null),
            'status' => $data['status'] ?? FuelTank::STATUS_ACTIVE,
        ];
    }

    /** @param array<int, array<string, mixed>> $points */
    private function syncCalibration(FuelTank $tank, array $points): void
    {
        $previousLevel = -1;
        $previousVolume = -1;
        $normal = [];
        foreach ($points as $point) {
            $level = $this->nonNegativeInt($point['level_millimeters'] ?? null, 'ارتفاع المعايرة');
            $volume = $this->nonNegativeInt($point['volume_milliliters'] ?? null, 'حجم المعايرة');
            if ($level <= $previousLevel || $volume < $previousVolume || $volume > $tank->capacity_milliliters) {
                throw new RuntimeException('نقاط المعايرة يجب أن تصعد في الارتفاع والحجم وألا تتجاوز سعة الخزان.');
            }
            $normal[] = ['tenant_id' => $tank->tenant_id, 'branch_id' => $tank->branch_id, 'level_millimeters' => $level, 'volume_milliliters' => $volume];
            $previousLevel = $level;
            $previousVolume = $volume;
        }

        $tank->calibrationPoints()->delete();
        if ($normal !== []) {
            $tank->calibrationPoints()->createMany($normal);
        }
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function pumpAttributes(array $data, FuelStation $station): array
    {
        if (! in_array($data['status'] ?? FuelPump::STATUS_ACTIVE, FuelPump::STATUSES, true)) {
            throw new RuntimeException('حالة المضخة غير صالحة.');
        }

        return [
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'pump_number' => trim($data['pump_number']),
            'name' => $this->nullableTrim($data['name'] ?? null),
            'controller_key' => $this->nullableTrim($data['controller_key'] ?? null),
            'status' => $data['status'] ?? FuelPump::STATUS_ACTIVE,
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function nozzleAttributes(array $data): array
    {
        $pump = FuelPump::find($data['fuel_pump_id']);
        $tank = FuelTank::find($data['fuel_tank_id']);
        $fuelProduct = $this->fuelProduct($data['fuel_product_id']);
        if (! $pump || ! $tank || $pump->fuel_station_id !== $tank->fuel_station_id || $tank->fuel_product_id !== $fuelProduct->id) {
            throw new RuntimeException('يجب أن تنتمي المضخة والخزان ومنتج الوقود إلى خريطة محطة واحدة متطابقة.');
        }
        if (! in_array($data['status'] ?? FuelNozzle::STATUS_ACTIVE, FuelNozzle::STATUSES, true)) {
            throw new RuntimeException('حالة الفوهة غير صالحة.');
        }

        return [
            'branch_id' => $pump->branch_id,
            'fuel_station_id' => $pump->fuel_station_id,
            'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id,
            'fuel_product_id' => $fuelProduct->id,
            'nozzle_number' => trim($data['nozzle_number']),
            'controller_key' => $this->nullableTrim($data['controller_key'] ?? null),
            'meter_opening_milliliters' => $this->nonNegativeInt($data['meter_opening_milliliters'] ?? 0, 'قراءة العداد الافتتاحية'),
            'status' => $data['status'] ?? FuelNozzle::STATUS_ACTIVE,
        ];
    }

    /** @param array<string, mixed> $data @param list<string> $keys @return array<string, mixed> */
    private function merged(Model $model, array $data, array $keys): array
    {
        $next = [];
        foreach ($keys as $key) {
            $next[$key] = array_key_exists($key, $data) ? $data[$key] : $model->getAttribute($key);
        }

        return $next;
    }

    /** @return list<string> */
    private function stationRelations(): array
    {
        return ['branch', 'manager', 'defaultInventoryAccount', 'defaultRevenueAccount', 'defaultCogsAccount'];
    }

    private function assertStationCodeAvailable(string $code, ?string $exceptId = null): void
    {
        $taken = FuelStation::where('code', trim($code))->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('كود المحطة مستخدم مسبقاً.');
        }
    }

    private function assertFuelProductCodeAvailable(string $code, ?string $exceptId = null): void
    {
        $taken = FuelProduct::where('code', trim($code))->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('كود منتج الوقود مستخدم مسبقاً.');
        }
    }

    private function assertTankCodeAvailable(FuelStation $station, string $code, ?string $exceptId = null): void
    {
        $taken = FuelTank::withoutGlobalScope(BranchScope::class)->where('fuel_station_id', $station->id)->where('code', trim($code))->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('كود الخزان مستخدم داخل هذه المحطة.');
        }
    }

    private function assertPumpNumberAvailable(FuelStation $station, string $number, ?string $exceptId = null): void
    {
        $taken = FuelPump::withoutGlobalScope(BranchScope::class)->where('fuel_station_id', $station->id)->where('pump_number', trim($number))->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('رقم المضخة مستخدم داخل هذه المحطة.');
        }
    }

    private function assertNozzleNumberAvailable(string $pumpId, string $number, ?string $exceptId = null): void
    {
        $taken = FuelNozzle::withoutGlobalScope(BranchScope::class)->where('fuel_pump_id', $pumpId)->where('nozzle_number', trim($number))->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('رقم الفوهة مستخدم داخل هذه المضخة.');
        }
    }

    private function assertAtgKeyAvailable(?string $key, ?string $exceptId = null): void
    {
        if ($key === null) {
            return;
        }
        $taken = FuelTank::withoutGlobalScope(BranchScope::class)->where('atg_source_key', $key)->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('معرّف مصدر ATG مستخدم مسبقاً.');
        }
    }

    /** @param class-string<Model> $class */
    private function assertControllerKeyAvailable(string $class, ?string $key, ?string $exceptId = null): void
    {
        if ($key === null) {
            return;
        }
        $taken = $class::withoutGlobalScope(BranchScope::class)->where('controller_key', $key)->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))->exists();
        if ($taken) {
            throw new RuntimeException('معرّف المتحكم الميداني مستخدم مسبقاً.');
        }
    }

    private function positiveInt(mixed $value, string $label): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT);
        if ($number === false || $number < 1) {
            throw new RuntimeException("{$label} يجب أن تكون عدداً صحيحاً موجباً.");
        }

        return $number;
    }

    private function nonNegativeInt(mixed $value, string $label): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT);
        if ($number === false || $number < 0) {
            throw new RuntimeException("{$label} يجب أن تكون عدداً صحيحاً غير سالب.");
        }

        return $number;
    }

    private function nullableInt(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return $this->positiveInt($value, 'الكثافة');
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
