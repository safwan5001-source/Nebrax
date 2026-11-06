<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
use App\Models\FuelReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * FUEL-B2 — سياسة فصل المعتمِد (`fuel_distinct_approver_required`) لاستلام الوقود وتسوية المخزون:
 *  - حالة ثلاثية: المحطة القائمة (قبل الحدّ) false بسلوكها السابق، والجديدة true، وأي قيمة صريحة (محطة ثم مستأجر) تتقدّم.
 *  - المنشئ لا يعتمد سجله حين تلزم السياسة (داخل الخدمة، أياً كان المفتاح الذي مرّ به)، ولا يترك أثراً مخزنياً أو محاسبياً.
 *  - اعتماد الوردية له سياسته ولا يتأثر.
 */
class FuelDistinctApproverTest extends TestCase
{
    use RefreshDatabase;
    use GivesFuelDeliveryCost;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';
    private const KEY = 'fuel_distinct_approver_required';
    private const CUTOVER = '2026-06-01T00:00:00Z';

    private string $tenantId;

    // ───────────────────────── حسم السياسة ─────────────────────────

    /** @test */
    public function an_existing_station_keeps_the_old_behaviour_and_a_new_one_starts_protected(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        $this->assertFalse($this->effective($f['station_old']), 'محطة أقدم من الحدّ تحفظ سلوكها السابق');
        $this->assertTrue($this->effective($f['station_new']), 'محطة بعد الحدّ تبدأ محمية');

        // الحدّ على حدّه بالضبط ⇒ جديدة.
        DB::table('fuel_stations')->where('id', $f['station_old']->id)->update(['created_at' => self::CUTOVER]);
        $this->assertTrue($this->effective($f['station_old']->fresh()));
    }

    /** @test */
    public function no_cutover_or_an_invalid_one_never_turns_the_policy_on_by_itself(): void
    {
        $f = $this->fixture();

        foreach ([null, '', '   ', 'not-a-date'] as $cutover) {
            $this->cutover($cutover);
            $this->assertFalse($this->effective($f['station_new']), 'لا حسم تلقائي عند حدّ غير صالح: ' . json_encode($cutover));
        }
    }

    /** @test */
    public function an_explicit_station_or_tenant_decision_always_beats_the_default(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        // قرار المستأجر الصريح false يحمي محطاته الجديدة من الحسم الافتراضي.
        $this->withToken($f['owner'])->putJson(self::BASE . '/settings', [self::KEY => false, 'reason' => 'تعطيل صريح'])->assertOk();
        $this->assertFalse($this->effective($f['station_new']));
        // وتفعيله الصريح يشمل المحطة القديمة.
        $this->withToken($f['owner'])->putJson(self::BASE . '/settings', [self::KEY => true, 'reason' => 'تفعيل صريح'])->assertOk();
        $this->assertTrue($this->effective($f['station_old']));

        // قرار المحطة يتقدّم على المستأجر في الاتجاهين.
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_old']->id . '/settings', [self::KEY => false, 'reason' => 'استثناء'])->assertOk();
        $this->assertFalse($this->effective($f['station_old']));
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => true])->assertOk();
        $this->assertTrue($this->effective($f['station_new']));
        // وإزالة override المحطة (null) تعيدها لقرار المستأجر.
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_old']->id . '/settings', [self::KEY => null])->assertOk();
        $this->assertTrue($this->effective($f['station_old']));
    }

    /** @test */
    public function the_settings_api_exposes_the_effective_value_validates_it_and_audits_changes(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        $this->assertTrue($this->withToken($f['owner'])->getJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings')->assertOk()->json('data.' . self::KEY));
        $this->assertFalse($this->withToken($f['owner'])->getJson(self::BASE . '/stations/' . $f['station_old']->id . '/settings')->assertOk()->json('data.' . self::KEY));
        $this->assertNull($this->withToken($f['owner'])->getJson(self::BASE . '/settings')->assertOk()->json('data.' . self::KEY), 'على مستوى المستأجر «لم يُحسم» يبقى null');

        $this->withToken($f['owner'])->putJson(self::BASE . '/settings', [self::KEY => 'yes'])->assertStatus(422);
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => 'yes'])->assertStatus(422);

        $before = DB::table('fuel_station_configuration_events')->where('setting_key', self::KEY)->count();
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false, 'reason' => 'اختبار تدقيق'])->assertOk();
        $this->assertSame($before + 1, DB::table('fuel_station_configuration_events')->where('setting_key', self::KEY)->count());

        // لا override على مستوى الجهاز لسياسة حوكمة.
        $this->expectException(RuntimeException::class);
        app(FuelStationSettingsService::class)->putDevice($f['station_new'], 'pump-1', self::KEY, true);
    }

    /** @test */
    public function the_shift_approval_policy_is_not_touched(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);
        $settings = app(FuelStationSettingsService::class);

        $this->assertTrue($settings->forStation($f['station_new'])['shift_supervisor_approval_required']);
        $this->assertTrue($settings->forStation($f['station_old'])['shift_supervisor_approval_required']);
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false])->assertOk();
        $this->assertTrue($settings->forStation($f['station_new'])['shift_supervisor_approval_required']);
    }

    // ───────────────────────── استلام الوقود ─────────────────────────

    /** @test */
    public function the_creator_cannot_approve_their_own_delivery_when_the_policy_applies_and_nothing_is_posted(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        $delivery = $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'sod-d-1')))->assertCreated()->json('data');
        $this->setCostDirectly($delivery['id']);
        $response = $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertStatus(422);

        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $delivery['id'])->value('status'));
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', FuelDelivery::class)->count());
        $this->assertSame(0, DB::table('fuel_operational_ledgers')->count());

        // معتمِد آخر يعتمدها، فيظهر الأثر مرة واحدة.
        $this->withToken($f['approver'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame(1, DB::table('stock_movements')->count());
        // وإعادة الاعتماد (من أي أحد) مرفوضة.
        $this->withToken($f['approver'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertStatus(422);
        $this->assertSame(1, DB::table('stock_movements')->count());
    }

    /** @test */
    public function the_creator_may_approve_when_the_policy_is_off_and_the_policy_is_read_at_approval_time(): void
    {
        $f = $this->fixture();
        $this->cutover(null);

        // محطة قائمة (سلوك سابق): المنشئ يعتمد.
        $a = $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'sod-d-off')))->assertCreated()->json('data');
        $this->setCostDirectly($a['id']);
        $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries/' . $a['id'] . '/approve')->assertOk();

        // الإعداد يُقرأ لحظة الاعتماد: يُنشأ والسياسة مفعَّلة، ثم تُعطَّل صراحةً، فيُقبل الاعتماد.
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => true])->assertOk();
        $b = $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'sod-d-flip')))->assertCreated()->json('data');
        $this->setCostDirectly($b['id']);
        $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries/' . $b['id'] . '/approve')->assertStatus(422);
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false, 'reason' => 'قرار إداري'])->assertOk();
        $this->withToken($f['creator'])->postJson(self::BASE . '/deliveries/' . $b['id'] . '/approve')->assertOk();
    }

    /** @test */
    public function a_record_with_no_known_creator_can_be_approved_by_anyone(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        // استلام أنشأته مهمة نظام/بيانات تاريخية: created_by فارغ ⇒ لا يطابق أي معتمِد.
        $delivery = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'sod-d-null'))->assertCreated()->json('data');
        DB::table('fuel_deliveries')->where('id', $delivery['id'])->update(['created_by' => null]);

        $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();
    }

    // ───────────────────────── تسوية المخزون ─────────────────────────

    /** @test */
    public function the_creator_cannot_approve_their_own_reconciliation_when_the_policy_applies(): void
    {
        $f = $this->fixture();
        $this->cutover(self::CUTOVER);

        $draft = $this->draftReconciliation($f['creator'], $f, 'sod-r-1');
        $response = $this->withToken($f['creator'])->postJson(self::BASE . '/reconciliations/' . $draft['id'] . '/approve')->assertStatus(422);

        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', DB::table('fuel_reconciliations')->where('id', $draft['id'])->value('status'));
        $this->assertSame(0, DB::table('fuel_operational_ledgers')->where('fuel_reconciliation_id', $draft['id'])->count());

        $this->withToken($f['approver'])->postJson(self::BASE . '/reconciliations/' . $draft['id'] . '/approve')->assertOk();
        $this->assertSame(1, DB::table('fuel_operational_ledgers')->where('fuel_reconciliation_id', $draft['id'])->count());
        $this->withToken($f['approver'])->postJson(self::BASE . '/reconciliations/' . $draft['id'] . '/approve')->assertStatus(422);
        $this->assertSame(1, DB::table('fuel_operational_ledgers')->where('fuel_reconciliation_id', $draft['id'])->count());
    }

    /** @test */
    public function the_creator_may_approve_their_reconciliation_when_the_policy_is_off(): void
    {
        $f = $this->fixture();
        $this->cutover(null);

        $draft = $this->draftReconciliation($f['creator'], $f, 'sod-r-off');
        $this->withToken($f['creator'])->postJson(self::BASE . '/reconciliations/' . $draft['id'] . '/approve')->assertOk();
        $this->assertSame('approved', FuelReconciliation::findOrFail($draft['id'])->status);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function cutover(?string $iso): void
    {
        config(['fuel_stations.distinct_approver_cutover_at' => $iso]);
    }

    private function effective(FuelStation $station): bool
    {
        return app(FuelStationSettingsService::class)->forStation($station)[self::KEY];
    }

    /** @return array<string,mixed> */
    private function draftReconciliation(string $token, array $f, string $key): array
    {
        $reading = $this->withToken($token)->postJson(self::BASE . '/readings', [
            'fuel_station_id' => $f['station_new']->id, 'fuel_tank_id' => $f['tank_new']->id, 'reading_type' => 'physical',
            'quantity_liters' => '0', 'evidence_key' => $key,
        ])->assertCreated()->json('data');

        return $this->withToken($token)->postJson(self::BASE . '/reconciliations', [
            'fuel_station_id' => $f['station_new']->id, 'fuel_tank_id' => $f['tank_new']->id, 'physical_reading_id' => $reading['id'],
        ])->assertCreated()->json('data');
    }

    /** @return array<string,mixed> */
    private function deliveryPayload(array $f, string $key): array
    {
        return [
            'fuel_station_id' => $f['station_new']->id, 'fuel_tank_id' => $f['tank_new']->id, 'fuel_product_id' => $f['fuel']->id,
            'warehouse_id' => $f['warehouse_new']->id, 'supplier_id' => $f['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key,
        ];
    }

    /** @param list<string> $permissions */
    private function tokenFor(string $name, array $permissions): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $role = Role::create(['tenant_id' => $this->tenantId, 'slug' => "fuel-b2sod-{$name}", 'name' => $name, 'permissions' => $permissions, 'is_system' => false]);

        return User::create(['tenant_id' => $this->tenantId, 'name' => $name, 'email' => "{$name}@fuel-b2sod.test", 'password' => 'password123', 'role' => $role->slug])->createToken('api')->plainTextToken;
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-b2sod', 'owner@fuel-b2sod.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b2_sod', reason: 'اختبار فصل المعتمِد B2.',
        );
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouseNew = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseOld = Warehouse::create(['name' => 'مخزن قديم', 'code' => 'WH-B2-OLD', 'branch_id' => $branch->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود B2SOD mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-B2SOD', 'name' => 'وقود B2SOD']);
        $mk = function (Warehouse $warehouse, string $code) use ($branch, $fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);

            return [$station, $tank];
        };
        [$stationNew, $tankNew] = $mk($warehouseNew, 'NEW');
        [$stationOld, $tankOld] = $mk($warehouseOld, 'OLD');
        // «القديمة» سبقت حدّ التفعيل بتاريخ إنشاء (عمود لا يقبل التعبئة من API).
        DB::table('fuel_stations')->where('id', $stationOld->id)->update(['created_at' => '2026-01-01 00:00:00']);
        DB::table('fuel_stations')->where('id', $stationNew->id)->update(['created_at' => '2026-07-01 00:00:00']);

        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد B2SOD', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI B2SOD', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار B2'])->assertOk();

        $keys = ['fuel_stations.view', 'fuel_stations.manage'];

        return [
            'owner' => $auth['token'],
            'creator' => $this->tokenFor('creator', $keys),
            'approver' => $this->tokenFor('approver', $keys),
            'fuel' => $fuel, 'supplier' => $supplier,
            'station_new' => $stationNew->fresh(), 'tank_new' => $tankNew, 'warehouse_new' => $warehouseNew,
            'station_old' => $stationOld->fresh(), 'tank_old' => $tankOld, 'warehouse_old' => $warehouseOld,
        ];
    }
}
