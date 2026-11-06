<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\FuelStaffTemplates;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;

/**
 * FUEL-B3 — fixture مشترك: مستأجر بفرعين وثلاث محطات (s1،s2 في الفرع A بمخزنين مختلفين؛ s3 في الفرع B)، وموظفون بأدوار قديمة وجديدة.
 *
 * @property string $tenantId
 */
trait BuildsFuelStaffFixture
{
    private string $tenantId;

    /** @var array<string, mixed> */
    private array $fx = [];

    /** صلاحيات مدير يملك التفويض الكامل لقالب «مدير محطة» (ما لا يملكه لا يستطيع منحه). @return list<string> */
    private function managerPermissions(): array
    {
        return array_values(array_unique([...FuelStaffTemplates::permissions(FuelStaffTemplates::STATION_MANAGER), 'fuel.staff.manage']));
    }

    private function buildFixture(): void
    {
        $auth = $this->registerTenant('fuel-b3', 'owner@fuel-b3.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b3', reason: 'اختبار إدارة موظفي المحطات B3.',
        );

        // التقارير تحت تطبيق `fuel_stations.maintenance` (شذوذ قائم موثَّق في تدقيق الوقود).
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->tenantId), 'fuel_stations.maintenance', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b3_reports', reason: 'تقارير الوقود لاختبار B3.',
        );

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B3B', 'name' => 'فرع ب']);
        $wA1 = Warehouse::where('is_default', true)->firstOrFail();
        $wA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-B3-A2', 'branch_id' => $branchA->id]);
        $wB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B3-B', 'branch_id' => $branchB->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود B3 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-B3', 'name' => 'وقود B3']);
        $mk = function (Branch $branch, Warehouse $warehouse, string $code) use ($fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);

            return [$station, $tank];
        };
        [$s1, $t1] = $mk($branchA, $wA1, 'B3S1');
        [$s2, $t2] = $mk($branchA, $wA2, 'B3S2');
        [$s3, $t3] = $mk($branchB, $wB, 'B3S3');
        $supplier = Partner::create(['branch_id' => $branchA->id, 'type' => 'supplier', 'name' => 'مورد B3', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI B3', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson('/api/fuel-stations/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار B3'])->assertOk();

        $this->fx = compact('branchA', 'branchB', 'wA1', 'wA2', 'wB', 's1', 's2', 's3', 't1', 't2', 't3', 'fuel', 'supplier') + ['owner' => $auth['token']];
    }

    /**
     * @param  list<string>|null  $permissions  null = دور مبني قائم (staff/accountant/admin…) بلا إنشاء دور جديد
     * @param  list<string>|null  $stations     null = بلا تقييد محطات (قديم)؛ مصفوفة = مقيَّد صراحةً بها
     * @return array{user: User, token: string}
     */
    private function makeUser(string $name, string $role, ?array $permissions = null, ?array $stations = null, ?array $branches = null, ?array $warehouses = null): array
    {
        app(TenantContext::class)->set($this->tenantId);
        if ($permissions !== null) {
            Role::create(['tenant_id' => $this->tenantId, 'slug' => $role, 'name' => $role, 'permissions' => $permissions, 'is_system' => false]);
        }
        $user = User::create(['tenant_id' => $this->tenantId, 'name' => $name, 'email' => "{$name}@fuel-b3.test", 'password' => 'password123', 'role' => $role]);
        if ($stations !== null) {
            $user->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
            $user->fuelStations()->sync($stations);
        }
        if ($branches !== null) {
            $user->branches()->sync($branches);
        }
        if ($warehouses !== null) {
            $user->warehouses()->sync($warehouses);
        }

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    /** @return array<string,mixed> */
    private function deliveryPayload(FuelStation $station, FuelTank $tank, Warehouse $warehouse, string $key): array
    {
        return [
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $this->fx['fuel']->id,
            'warehouse_id' => $warehouse->id, 'supplier_id' => $this->fx['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key,
        ];
    }
}
