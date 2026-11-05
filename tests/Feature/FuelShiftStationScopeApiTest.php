<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCorrection;
use App\Models\FuelShiftEvent;
use App\Models\FuelShiftMeterReading;
use App\Models\FuelShiftStaffAssignment;
use App\Models\FuelShiftTankReading;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * #2014 — تفويض المحطة/المخزن في **كل** مسارات كتابة (وقراءة) الوردية على الخادم.
 *
 * `FuelStation` مصنَّفة CompanyWide، و`FuelShift` BranchScoped (فرع فقط). كان `FuelShiftController`
 * لا يستعمل `AuthorizesFuelStationScope`، فمستخدم مقيَّد بمخزن/محطة داخل الفرع نفسه يفتح وردية ويسجّل
 * قراءات ونقداً ويغلق ويرى وردية محطة أخرى من الفرع بمجرد معرفة المعرّف. هذا الاختبار يثبّت العقد:
 * خارج النطاق = 404 موحّد **قبل أي أثر جانبي**، ولا يغيّر ما هو داخل النطاق.
 *
 * بيانات معزولة بالكامل (مستأجرون اصطناعيون على قاعدة اختبار)؛ لا بيانات محطات حقيقية.
 */
class FuelShiftStationScopeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations/shifts';

    /** @test */
    public function a_warehouse_restricted_user_cannot_open_a_shift_on_another_station_of_the_same_branch(): void
    {
        $f = $this->fixture();

        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/open', $this->openPayload($f['station_a2'], 'wh-out-open'))->assertNotFound();
        $this->assertSame(0, $this->n(FuelShift::class));
        $this->assertSame(0, $this->n(FuelShiftEvent::class));

        // داخل نطاقه يعمل كالمعتاد (لا حجب زائد).
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/open', $this->openPayload($f['station_a'], 'wh-in-open'))
            ->assertCreated()->assertJsonPath('data.station_id', $f['station_a']->id);
        $this->assertSame(1, $this->n(FuelShift::class));
    }

    /** @test */
    public function a_branch_restricted_user_cannot_open_a_shift_on_another_branch_even_with_the_branch_header(): void
    {
        $f = $this->fixture();

        // بلا ترويسة: الفرع النشط فرعه، والمحطة من فرع آخر.
        $this->withToken($f['br_seller_token'])->postJson(self::BASE . '/open', $this->openPayload($f['station_b'], 'br-out-open-1'))->assertNotFound();
        // ترويسة X-Branch-Id لفرع لا يملكه: تُتجاهل (طلب لا إذن) ولا تفتح الباب.
        $this->withToken($f['br_seller_token'])->withHeaders(['X-Branch-Id' => $f['branch_b']->id])
            ->postJson(self::BASE . '/open', $this->openPayload($f['station_b'], 'br-out-open-2'))->assertNotFound();
        $this->assertSame(0, $this->n(FuelShift::class));
        $this->assertSame(0, $this->n(FuelShiftEvent::class));
    }

    /** @test */
    public function every_shift_route_hides_a_shift_whose_station_is_outside_the_users_scope_and_has_no_side_effects(): void
    {
        $f = $this->fixture();
        $owner = $f['owner_token'];

        $shiftA2 = $this->openAs($owner, $f['station_a2'], 'owner-a2')['id'];
        $shiftB = $this->openAs($owner, $f['station_b'], 'owner-b', $f['branch_b'])['id'];
        $this->assertSame(2, $this->n(FuelShift::class));
        $before = $this->counts();

        $seller = $f['wh_seller_token']; // مقيَّد بمخزن أ فقط (الفرع أ، غير مقيَّد بفرع)
        $supervisor = $f['wh_supervisor_token'];

        // ── القراءة: لا تظهر في القائمة ولا تُفتح بمعرّفها (404 لا 403 حتى لا يُكشف الوجود).
        $this->withToken($seller)->getJson(self::BASE)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->getJson(self::BASE . '?branch=all')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->getJson(self::BASE . '?station_id=' . $f['station_a2']->id)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->getJson(self::BASE . "/{$shiftA2}")->assertNotFound();
        $this->withToken($seller)->getJson(self::BASE . "/{$shiftB}")->assertNotFound();

        // ── الكتابة: كل POST على وردية خارج النطاق = 404 قبل أي أثر.
        $nozzle = $f['nozzle_a2'];
        $tank = $f['tank_a2'];
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftA2}/staff", ['user_id' => $f['wh_seller']->id, 'role' => 'attendant'])->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftA2}/meter-readings", [
            'fuel_nozzle_id' => $nozzle->id, 'reading_stage' => 'opening', 'meter_milliliters' => 1000, 'evidence_key' => 'x-meter',
        ])->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftA2}/tank-readings", [
            'fuel_tank_id' => $tank->id, 'reading_stage' => 'opening', 'quantity_milliliters' => 1000, 'evidence_key' => 'x-tank',
        ])->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftA2}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 100, 'reason' => 'محاولة', 'idempotency_key' => 'x-cash',
        ])->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftA2}/close", ['counted_cash_minor' => 0])->assertNotFound();
        $this->withToken($supervisor)->postJson(self::BASE . "/{$shiftA2}/approve", ['note' => 'محاولة'])->assertNotFound();
        $this->withToken($supervisor)->postJson(self::BASE . "/{$shiftA2}/cash-variance/review", ['note' => 'محاولة'])->assertNotFound();
        $this->withToken($supervisor)->postJson(self::BASE . "/{$shiftA2}/corrections", [
            'target_type' => 'cash_count', 'reason' => 'محاولة', 'proposed' => ['counted_cash_minor' => 1],
        ])->assertNotFound();

        $this->assertSame($before, $this->counts(), 'لا أثر جانبي على أي جدول وردية عند الرفض.');
        $this->assertSame('open', FuelShift::withoutGlobalScopes()->findOrFail($shiftA2)->status);

        // المالك غير المقيَّد يرى الورديتين ويعمل عليهما (لا تغيير لغير المقيَّد).
        // (قائمة الورديات تتقيّد بالفرع النشط عبر BranchScope العالمي؛ تبديل الفرع صريح بالترويسة.)
        $this->withToken($owner)->withHeaders(['X-Branch-Id' => $f['branch_a']->id])->getJson(self::BASE)->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shiftA2);
        $this->withToken($owner)->withHeaders(['X-Branch-Id' => $f['branch_b']->id])->getJson(self::BASE)->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shiftB);
        $this->withToken($owner)->withHeaders(['X-Branch-Id' => $f['branch_a']->id])->getJson(self::BASE . "/{$shiftA2}")->assertOk();
    }

    /** @test */
    public function an_in_scope_user_keeps_the_full_lifecycle_and_sees_only_in_scope_shifts(): void
    {
        $f = $this->fixture();
        $this->openAs($f['owner_token'], $f['station_a2'], 'owner-a2-visible');

        $seller = $f['wh_seller_token'];
        $shiftId = $this->openAs($seller, $f['station_a'], 'seller-a')['id'];

        $this->withToken($seller)->getJson(self::BASE)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shiftId);
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/staff", ['user_id' => $f['wh_seller']->id, 'role' => 'attendant'])->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/meter-readings", [
            'fuel_nozzle_id' => $f['nozzle_a']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 1000, 'evidence_key' => 'in-meter',
        ])->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/tank-readings", [
            'fuel_tank_id' => $f['tank_a']->id, 'reading_stage' => 'opening', 'quantity_milliliters' => 5000, 'evidence_key' => 'in-tank',
        ])->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 500, 'reason' => 'فكة', 'idempotency_key' => 'in-cash',
        ])->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/close", ['counted_cash_minor' => 1500])
            ->assertOk()->assertJsonPath('data.status', 'closed');
        $this->withToken($f['wh_supervisor_token'])->postJson(self::BASE . "/{$shiftId}/approve", ['note' => 'اعتماد'])
            ->assertOk()->assertJsonPath('data.status', 'approved');
    }

    /** @test */
    public function a_shift_in_another_branch_is_hidden_from_a_branch_restricted_user_including_branch_all(): void
    {
        $f = $this->fixture();
        $shiftB = $this->openAs($f['owner_token'], $f['station_b'], 'owner-b-only', $f['branch_b'])['id'];

        $seller = $f['br_seller_token'];
        $this->withToken($seller)->getJson(self::BASE . "/{$shiftB}")->assertNotFound();
        $this->withToken($seller)->withHeaders(['X-Branch-Id' => $f['branch_b']->id])->getJson(self::BASE . "/{$shiftB}")->assertNotFound();
        $this->withToken($seller)->getJson(self::BASE . '?branch=all')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftB}/close", ['counted_cash_minor' => 0])->assertNotFound();
        $this->assertSame('open', FuelShift::withoutGlobalScopes()->findOrFail($shiftB)->status);
    }

    /** @test */
    public function revoking_scope_after_the_screen_was_opened_blocks_the_next_write_and_a_replayed_key_never_returns_the_shift(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $payload = $this->openPayload($f['station_a'], 'revoke-open');
        $shiftId = $this->withToken($seller)->postJson(self::BASE . '/open', $payload)->assertCreated()->json('data.id');

        // يُنقل المستخدم إلى مخزن محطة أخرى بعد فتح الشاشة (تغيّر الصلاحيات).
        $f['wh_seller']->warehouses()->sync([$f['warehouse_a2']->id]);

        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 100, 'reason' => 'بعد السحب', 'idempotency_key' => 'revoke-cash',
        ])->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/close", ['counted_cash_minor' => 0])->assertNotFound();
        // إعادة إرسال المفتاح نفسه لا تُعيد الوردية لمن فقد النطاق.
        $this->withToken($seller)->postJson(self::BASE . '/open', $payload)->assertNotFound();
        $this->assertSame(0, $this->n(FuelShiftCashMovement::class));
        $this->assertSame('open', FuelShift::withoutGlobalScopes()->findOrFail($shiftId)->status);
    }

    /** @test */
    public function removing_the_permission_after_the_screen_was_opened_is_enforced_per_request(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $shiftId = $this->openAs($seller, $f['station_a'], 'perm-open')['id'];

        Role::where('slug', 'fuel-shift-seller')->update(['permissions' => ['fuel.shift.view', 'fuel.shift.open']]);

        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 100, 'reason' => 'بلا صلاحية', 'idempotency_key' => 'perm-cash',
        ])->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/close", ['counted_cash_minor' => 0])->assertForbidden();
        $this->assertSame(0, $this->n(FuelShiftCashMovement::class));
    }

    /** @test */
    public function replaying_an_in_scope_write_is_idempotent_and_creates_a_single_record(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $shiftId = $this->openAs($seller, $f['station_a'], 'idem-open')['id'];
        $cash = ['type' => 'cash_in', 'amount_minor' => 300, 'reason' => 'فكة', 'idempotency_key' => 'idem-cash'];
        $meter = ['fuel_nozzle_id' => $f['nozzle_a']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100, 'evidence_key' => 'idem-meter'];

        for ($i = 0; $i < 3; $i++) {
            $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/cash-movements", $cash)->assertCreated();
            $this->withToken($seller)->postJson(self::BASE . "/{$shiftId}/meter-readings", $meter)->assertCreated();
            $this->withToken($seller)->postJson(self::BASE . '/open', $this->openPayload($f['station_a'], 'idem-open'))->assertCreated();
        }
        $this->assertSame(1, $this->n(FuelShiftCashMovement::class));
        $this->assertSame(1, $this->n(FuelShiftMeterReading::class));
        $this->assertSame(1, $this->n(FuelShift::class));
    }

    /** @test */
    public function another_tenants_shift_and_user_are_never_reachable(): void
    {
        $f = $this->fixture();
        $shiftId = $this->openAs($f['owner_token'], $f['station_a'], 'tenant-open')['id'];
        $this->assertSame(1, $this->n(FuelShift::class));

        $this->withToken($f['other_tenant_token'])->getJson(self::BASE . "/{$shiftId}")->assertNotFound();
        $this->withToken($f['other_tenant_token'])->postJson(self::BASE . "/{$shiftId}/close", ['counted_cash_minor' => 0])->assertNotFound();
        $this->withToken($f['other_tenant_token'])->postJson(self::BASE . '/open', $this->openPayload($f['station_a'], 'tenant-x'))->assertNotFound();
        $this->assertSame(1, $this->n(FuelShift::class));
        $this->withToken($f['other_tenant_token'])->getJson(self::BASE)->assertOk()->assertJsonCount(0, 'data');

        // إسناد مستخدم من مستأجر آخر إلى وردية هذا المستأجر مرفوض ولا يُنشأ سجل.
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/{$shiftId}/staff", [
            'user_id' => $f['other_tenant_user']->id, 'role' => 'attendant',
        ])->assertStatus(422);
        // ومعرّف غير موجود أصلاً يعطي الاستجابة نفسها: لا يُكشف وجود مستخدم مؤسسة أخرى.
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/{$shiftId}/staff", [
            'user_id' => '00000000-0000-4000-8000-000000000000', 'role' => 'attendant',
        ])->assertStatus(422);
        $this->assertSame(0, $this->n(FuelShiftStaffAssignment::class));
    }

    /** @test */
    public function staff_without_access_to_the_stations_warehouse_cannot_be_assigned(): void
    {
        $f = $this->fixture();
        $shiftA2 = $this->openAs($f['owner_token'], $f['station_a2'], 'staff-a2')['id'];

        // مقيَّد بمخزن أ: لا يملك مخزن المحطة أ2 ⇒ لا يُسنَد إلى ورديتها.
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/{$shiftA2}/staff", [
            'user_id' => $f['wh_seller']->id, 'role' => 'attendant',
        ])->assertStatus(422);
        $this->assertSame(0, $this->n(FuelShiftStaffAssignment::class));

        // غير مقيَّد (المالك) يمكن إسناده.
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/{$shiftA2}/staff", [
            'user_id' => $f['owner']->id, 'role' => 'attendant',
        ])->assertCreated();
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model عدّ بلا نطاق فرع/مستأجر: الاختبار يراقب كل ما كُتب. */
    private function n(string $model): int
    {
        return $model::withoutGlobalScopes()->count();
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        return [
            'shifts' => $this->n(FuelShift::class), 'events' => $this->n(FuelShiftEvent::class), 'staff' => $this->n(FuelShiftStaffAssignment::class),
            'meters' => $this->n(FuelShiftMeterReading::class), 'tanks' => $this->n(FuelShiftTankReading::class),
            'cash' => $this->n(FuelShiftCashMovement::class), 'corrections' => $this->n(FuelShiftCorrection::class),
            'journals' => JournalEntry::withoutGlobalScopes()->count(), 'stock' => StockMovement::withoutGlobalScopes()->count(),
        ];
    }

    /** @return array<string,mixed> */
    private function openPayload(FuelStation $station, string $key): array
    {
        return ['fuel_station_id' => $station->id, 'opening_float_minor' => 1000, 'idempotency_key' => $key];
    }

    /** @return array<string,mixed> */
    private function openAs(string $token, FuelStation $station, string $key, ?Branch $branch = null): array
    {
        $headers = $branch === null ? [] : ['X-Branch-Id' => $branch->id];

        return $this->withToken($token)->withHeaders($headers)->postJson(self::BASE . '/open', $this->openPayload($station, $key))
            ->assertCreated()->json('data');
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        // مستأجر آخر أولاً (يبقى سياق المستأجر للثاني بعد تسجيله).
        $other = $this->registerTenant('fuel-shift-other', 'owner@fuel-shift-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_2014_scope_other', reason: 'مستأجر آخر لاختبار العزل.',
        );
        $otherRole = Role::create([
            'tenant_id' => $other['tenant_id'], 'slug' => 'fuel-shift-seller', 'name' => 'بائع وقود',
            'permissions' => ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'], 'is_system' => false,
        ]);
        $otherUser = User::withoutGlobalScopes()->where('tenant_id', $other['tenant_id'])->where('role', 'owner')->firstOrFail();

        $auth = $this->registerTenant('fuel-shift-scope', 'owner@fuel-shift-scope.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        app(EntitlementGrantService::class)->grant(
            $tenant, 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_2014_scope', reason: 'اختبار نطاق الوردية.',
        );
        $owner = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        app(BranchContext::class)->set($branchA->id);
        $product = Product::create([
            'tenant_id' => $tenantId, 'branch_id' => $branchA->id, 'sku' => 'FUEL-SCOPE-P', 'name' => 'منتج وقود نطاق',
            'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuel = FuelProduct::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => 'FUEL-SC', 'name' => 'بنزين نطاق']);

        $mk = function (Branch $branch, Warehouse $warehouse, string $code) use ($tenantId, $fuel, $owner) {
            $station = FuelStation::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code,
            ]);
            $tank = FuelTank::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
            ]);
            $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-' . $code]);
            $nozzle = FuelNozzle::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
                'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'N-' . $code,
            ]);
            app(FuelStationSettingsService::class)->putStationValues($station, [
                'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
                'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
                'shift_mandatory_staff_assignment' => false, 'shift_supervisor_approval_required' => false,
            ], $owner, 'تهيئة اختبار نطاق الوردية');

            return [$station, $tank, $nozzle];
        };
        [$stationA, $tankA, $nozzleA] = $mk($branchA, $warehouseA, 'A');
        [$stationA2, $tankA2, $nozzleA2] = $mk($branchA, $warehouseA2, 'A2');
        [$stationB, $tankB, $nozzleB] = $mk($branchB, $warehouseB, 'B');

        $sellerRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-shift-seller', 'name' => 'بائع وقود',
            'permissions' => ['fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'], 'is_system' => false,
        ]);
        $supervisorRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-shift-supervisor', 'name' => 'مشرف وقود',
            'permissions' => ['fuel.shift.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.shift.correct'], 'is_system' => false,
        ]);
        $mkUser = fn (string $name, string $email, Role $role) => User::create([
            'tenant_id' => $tenantId, 'name' => $name, 'email' => $email, 'password' => 'password123', 'role' => $role->slug,
        ]);
        // مقيَّد بمخزن أ فقط (الفرع غير مقيَّد): محطة أ2 من الفرع نفسه خارج نطاقه.
        $whSeller = $mkUser('بائع مخزن أ', 'wh-seller@fuel-shift-scope.test', $sellerRole);
        $whSeller->warehouses()->attach($warehouseA->id);
        $whSupervisor = $mkUser('مشرف مخزن أ', 'wh-supervisor@fuel-shift-scope.test', $supervisorRole);
        $whSupervisor->warehouses()->attach($warehouseA->id);
        // مقيَّد بالفرع أ فقط.
        $brSeller = $mkUser('بائع فرع أ', 'br-seller@fuel-shift-scope.test', $sellerRole);
        $brSeller->branches()->attach($branchA->id);

        return [
            'owner' => $owner, 'owner_token' => $auth['token'],
            'wh_seller' => $whSeller, 'wh_seller_token' => $whSeller->createToken('api')->plainTextToken,
            'wh_supervisor_token' => $whSupervisor->createToken('api')->plainTextToken,
            'br_seller_token' => $brSeller->createToken('api')->plainTextToken,
            'other_tenant_token' => $other['token'], 'other_tenant_user' => $otherUser,
            'branch_a' => $branchA, 'branch_b' => $branchB,
            'warehouse_a' => $warehouseA, 'warehouse_a2' => $warehouseA2, 'warehouse_b' => $warehouseB,
            'station_a' => $stationA, 'tank_a' => $tankA, 'nozzle_a' => $nozzleA,
            'station_a2' => $stationA2, 'tank_a2' => $tankA2, 'nozzle_a2' => $nozzleA2,
            'station_b' => $stationB, 'tank_b' => $tankB, 'nozzle_b' => $nozzleB,
        ];
    }
}
