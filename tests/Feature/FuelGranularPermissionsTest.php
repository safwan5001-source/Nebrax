<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FUEL-B2 — مفاتيح الوقود الدقيقة لدورة الاستلام والقراءات والتسوية وفواتير الموردين:
 *  - كل مسار يقبل مفتاحه الدقيق أو المفتاح القديم، ويرفض غيرهما (403) — على الخادم لا في الواجهة.
 *  - الأدوار المخزَّنة القديمة (`fuel_stations.view|manage`) تعمل كما كانت.
 *  - القبول بأي مفتاح لا يتجاوز نطاق الفرع/المخزن ولا فصل المعتمِد ولا يكشف التكلفة ولا يعبر المستأجرين.
 */
class FuelGranularPermissionsTest extends TestCase
{
    use RefreshDatabase;
    use GivesFuelDeliveryCost;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';
    private const UNKNOWN = '00000000-0000-4000-8000-000000000001';

    /** @var list<string> */
    private const NEW_KEYS = [
        'fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve',
        'fuel.reading.view', 'fuel.reading.record',
        'fuel.reconciliation.view', 'fuel.reconciliation.create', 'fuel.reconciliation.approve',
        'fuel.supplier_invoice.view', 'fuel.supplier_invoice.manage', 'fuel.supplier_invoice.match',
    ];

    /** @return list<array{0:string,1:string,2:string,3:string}> [verb, path, newKey, legacyKey] */
    private static function routes(): array
    {
        $u = self::UNKNOWN;

        return [
            ['GET', '/readings', 'fuel.reading.view', 'fuel_stations.view'],
            ['POST', '/readings', 'fuel.reading.record', 'fuel_stations.manage'],
            ['GET', '/reconciliations', 'fuel.reconciliation.view', 'fuel_stations.view'],
            ['POST', '/reconciliations', 'fuel.reconciliation.create', 'fuel_stations.manage'],
            ['POST', "/reconciliations/{$u}/approve", 'fuel.reconciliation.approve', 'fuel_stations.manage'],
            ['GET', '/deliveries', 'fuel.delivery.view', 'fuel_stations.view'],
            ['GET', "/deliveries/{$u}", 'fuel.delivery.view', 'fuel_stations.view'],
            ['POST', '/deliveries', 'fuel.delivery.create', 'fuel_stations.manage'],
            ['POST', "/deliveries/{$u}/approve", 'fuel.delivery.approve', 'fuel_stations.manage'],
            ['GET', '/supplier-invoices', 'fuel.supplier_invoice.view', 'fuel_stations.view'],
            ['GET', "/supplier-invoices/{$u}", 'fuel.supplier_invoice.view', 'fuel_stations.view'],
            ['POST', '/supplier-invoices', 'fuel.supplier_invoice.manage', 'fuel_stations.manage'],
            ['POST', "/supplier-invoices/{$u}/matches", 'fuel.supplier_invoice.match', 'fuel_stations.manage'],
        ];
    }

    /** @test */
    public function every_new_key_is_in_the_role_catalog_and_none_is_granted_to_the_builtin_roles(): void
    {
        foreach (self::NEW_KEYS as $key) {
            $this->assertContains($key, Rbac::PERMISSIONS, $key);
            foreach (['accountant', 'staff', 'self_service'] as $role) {
                $this->assertFalse(Rbac::allows($role, $key), "{$role} must not receive {$key} implicitly");
            }
            $this->assertTrue(Rbac::allows('owner', $key));
            $this->assertTrue(Rbac::allows('admin', $key));
        }
    }

    /** @test */
    public function each_route_accepts_its_exact_key_or_the_legacy_key_and_refuses_everything_else(): void
    {
        $f = $this->fixture();

        $only = [];   // مفتاح دقيق واحد فقط
        $decoy = [];  // كل المفاتيح الدقيقة ما عدا الهدف (لا قديم)
        foreach (self::NEW_KEYS as $key) {
            $only[$key] = $this->tokenWithPermissions([$key]);
            $decoy[$key] = $this->tokenWithPermissions(array_values(array_diff(self::NEW_KEYS, [$key])));
        }
        $legacy = ['fuel_stations.view' => $this->tokenWithPermissions(['fuel_stations.view']), 'fuel_stations.manage' => $this->tokenWithPermissions(['fuel_stations.manage'])];
        $none = $this->tokenWithPermissions([]);

        foreach (self::routes() as [$verb, $path, $newKey, $legacyKey]) {
            $label = "{$verb} {$path}";
            $call = fn (string $token) => $this->withToken($token)->json($verb, self::BASE . $path, $verb === 'POST' ? [] : []);

            $this->assertNotSame(403, $call($only[$newKey])->getStatusCode(), "exact key must pass: {$label}");
            $this->assertNotSame(403, $call($legacy[$legacyKey])->getStatusCode(), "legacy key must pass: {$label}");
            $this->assertNotSame(403, $call($f['owner'])->getStatusCode(), "owner must pass: {$label}");
            $this->assertSame(403, $call($decoy[$newKey])->getStatusCode(), "other fine keys must not grant: {$label}");
            $this->assertSame(403, $call($none)->getStatusCode(), "no permission: {$label}");
        }

        // `fuel_stations.view` وحده لا يُنشئ ولا يعتمد (الكتابة تتطلب manage أو المفتاح الدقيق).
        $this->assertSame(403, $this->withToken($legacy['fuel_stations.view'])->postJson(self::BASE . '/deliveries', [])->getStatusCode());
        $this->assertSame(403, $this->withToken($legacy['fuel_stations.view'])->postJson(self::BASE . '/deliveries/' . self::UNKNOWN . '/approve')->getStatusCode());
    }

    /** @test */
    public function seller_supervisor_and_station_manager_get_exactly_their_own_slices(): void
    {
        $f = $this->fixture();
        $seller = $this->tokenWithPermissions(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open']);
        $supervisor = $this->tokenWithPermissions(['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.view', 'fuel.reading.record', 'fuel.reconciliation.view', 'fuel.reconciliation.create', 'fuel.supplier_invoice.view']);
        $manager = $this->tokenWithPermissions(['fuel_stations.view', ...array_diff(self::NEW_KEYS, [])]);

        // البائع: يقرأ ولا يكتب شيئاً من دورة الاستلام.
        $this->withToken($seller)->getJson(self::BASE . '/deliveries')->assertOk();
        $this->withToken($seller)->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'b2-seller'))->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . '/readings', [])->assertForbidden();

        // المشرف: ينشئ ويسجّل القراءات ويعدّ تسوية، لا يعتمد استلاماً ولا تسوية.
        $delivery = $this->withToken($supervisor)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'b2-sup')))->assertCreated()->json('data');
        $this->setCostDirectly($delivery['id']);
        $this->withToken($supervisor)->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertForbidden();
        $this->withToken($supervisor)->postJson(self::BASE . '/supplier-invoices', [])->assertForbidden();
        $this->assertSame('draft', FuelDelivery::findOrFail($delivery['id'])->status);

        // مدير المحطة: يعتمد ما أنشأه غيره.
        $this->withToken($manager)->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk()->assertJsonPath('data.status', 'approved');
    }

    /** @test */
    public function a_stored_legacy_role_keeps_working_and_cannot_use_its_legacy_key_to_skip_the_distinct_approver_policy(): void
    {
        $f = $this->fixture();
        $legacy = $this->tokenWithPermissions(['fuel_stations.view', 'fuel_stations.manage']);

        // محطة قائمة (قبل الحدّ): السلوك القديم حرفياً — الدور القديم ينشئ ويعتمد بنفسه.
        $this->useCutover(null);
        $own = $this->withToken($legacy)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'b2-legacy-1')))->assertCreated()->json('data');
        $this->setCostDirectly($own['id']);
        $this->withToken($legacy)->postJson(self::BASE . '/deliveries/' . $own['id'] . '/approve')->assertOk();

        // المحطة نفسها صارت «جديدة» بالسياسة (الحدّ في الماضي): المفتاح القديم لا يتجاوز الفصل.
        $this->useCutover('2000-01-01T00:00:00Z');
        $second = $this->withToken($legacy)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'b2-legacy-2')))->assertCreated()->json('data');
        $this->setCostDirectly($second['id']);
        $response = $this->withToken($legacy)->postJson(self::BASE . '/deliveries/' . $second['id'] . '/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', FuelDelivery::findOrFail($second['id'])->status);
        // ويعتمد بنفسه ما أنشأه غيره.
        $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries/' . $second['id'] . '/approve')->assertOk();
    }

    /** @test */
    public function a_new_key_never_crosses_the_branch_or_warehouse_scope(): void
    {
        $f = $this->fixture();
        $scoped = $this->tokenWithPermissions(['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.reading.record', 'fuel.reconciliation.create', 'fuel.reconciliation.approve'], warehouseIds: [$f['warehouse_a']->id]);

        // خارج نطاق مخزنه: إنشاء/اعتماد/قراءة/تسوية كلها 404 رغم امتلاكه المفاتيح الدقيقة.
        $this->withToken($scoped)->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'b2-out', $f['station_b'], $f['tank_b'], $f['warehouse_b']))->assertNotFound();
        $foreign = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'b2-foreign', $f['station_b'], $f['tank_b'], $f['warehouse_b']))->assertCreated()->json('data');
        $this->withToken($scoped)->postJson(self::BASE . '/deliveries/' . $foreign['id'] . '/approve')->assertNotFound();
        $this->withToken($scoped)->getJson(self::BASE . '/deliveries/' . $foreign['id'])->assertNotFound();
        $this->withToken($scoped)->postJson(self::BASE . '/readings', ['fuel_station_id' => $f['station_b']->id, 'fuel_tank_id' => $f['tank_b']->id, 'reading_type' => 'physical', 'quantity_liters' => '1', 'evidence_key' => 'b2-out-ev'])->assertNotFound();
        $this->withToken($scoped)->postJson(self::BASE . '/reconciliations', ['fuel_station_id' => $f['station_b']->id, 'fuel_tank_id' => $f['tank_b']->id])->assertNotFound();
        // الاستلام في فرع آخر: يُقرأ بلا عزل الفرع النشط (فحص مباشر للحالة لا عبر نطاق الاختبار).
        $this->assertSame('draft', \Illuminate\Support\Facades\DB::table('fuel_deliveries')->where('id', $foreign['id'])->value('status'));
        $this->assertSame(0, StockMovement::count());

        // وداخل نطاقه يعمل.
        $this->withToken($scoped)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'b2-in')))->assertCreated();
    }

    /** @test */
    public function the_new_keys_do_not_reveal_purchase_cost_without_the_cost_permission(): void
    {
        $f = $this->fixture();
        $viewer = $this->tokenWithPermissions(['fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.supplier_invoice.view']);
        $withCost = $this->tokenWithPermissions(['fuel.delivery.view', 'products.view_cost']);

        $delivery = $this->withToken($viewer)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, 'b2-cost')))->assertCreated()->json('data');
        $this->setCostDirectly($delivery['id']);
        $this->assertArrayNotHasKey('received_total_cost_minor', $delivery);
        $this->assertArrayNotHasKey('received_total_cost_minor', $this->withToken($viewer)->getJson(self::BASE . '/deliveries/' . $delivery['id'])->assertOk()->json('data'));
        $this->assertArrayNotHasKey('received_total_cost_minor', $this->withToken($viewer)->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk()->json('data'));
        $this->assertSame(2345, $this->withToken($withCost)->getJson(self::BASE . '/deliveries/' . $delivery['id'])->assertOk()->json('data.received_total_cost_minor'));
    }

    /** @test */
    public function another_tenants_approver_cannot_touch_this_tenants_delivery(): void
    {
        $f = $this->fixture();
        $delivery = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'b2-tenant'))->assertCreated()->json('data');

        $other = $this->registerTenant('globex-b2', 'owner@globex-b2.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b2_other', reason: 'مستأجر آخر.');
        $role = Role::create(['tenant_id' => $other['tenant_id'], 'slug' => 'globex-approver', 'name' => 'معتمد', 'permissions' => ['fuel.delivery.approve', 'fuel.delivery.view'], 'is_system' => false]);
        $foreignToken = User::create(['tenant_id' => $other['tenant_id'], 'name' => 'x', 'email' => 'x@globex-b2.test', 'password' => 'password123', 'role' => $role->slug])->createToken('api')->plainTextToken;

        $this->withToken($foreignToken)->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertNotFound();
        $this->withToken($foreignToken)->getJson(self::BASE . '/deliveries/' . $delivery['id'])->assertNotFound();
        // فحص مباشر للقاعدة (سياق الفرع بعد تسجيل المستأجر الثاني ليس سياق الأول).
        $this->assertSame('draft', \Illuminate\Support\Facades\DB::table('fuel_deliveries')->where('id', $delivery['id'])->value('status'));
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('journal_entries')->where('tenant_id', $this->tenantId)->where('source_type', FuelDelivery::class)->count());
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function useCutover(?string $iso): void
    {
        config(['fuel_stations.distinct_approver_cutover_at' => $iso]);
    }

    /** @param list<string> $permissions @param list<string>|null $warehouseIds */
    private function tokenWithPermissions(array $permissions, ?array $warehouseIds = null): string
    {
        $tenantId = $this->tenantId;
        app(TenantContext::class)->set($tenantId);
        $slug = 'fuel-b2-' . substr(md5(json_encode([$permissions, $warehouseIds]) . microtime(true) . random_int(0, PHP_INT_MAX)), 0, 10);
        Role::create(['tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $tenantId, 'name' => $slug, 'email' => "{$slug}@fuel-b2.test", 'password' => 'password123', 'role' => $slug]);
        if ($warehouseIds !== null) {
            $user->warehouses()->attach($warehouseIds);
        }

        return $user->createToken('api')->plainTextToken;
    }

    private string $tenantId;

    /** @return array<string,mixed> */
    private function deliveryPayload(array $f, string $key, ?FuelStation $station = null, ?FuelTank $tank = null, ?Warehouse $warehouse = null): array
    {
        return [
            'fuel_station_id' => ($station ?? $f['station_a'])->id, 'fuel_tank_id' => ($tank ?? $f['tank_a'])->id, 'fuel_product_id' => $f['fuel']->id,
            'warehouse_id' => ($warehouse ?? $f['warehouse_a'])->id, 'supplier_id' => $f['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key,
        ];
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-b2', 'owner@fuel-b2.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b2', reason: 'اختبار صلاحيات الوقود الدقيقة B2.',
        );
        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B2B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B2B', 'branch_id' => $branchB->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود B2 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-B2', 'name' => 'وقود B2']);
        $mk = function (Branch $branch, Warehouse $warehouse, string $code) use ($fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);

            return [$station, $tank];
        };
        [$stationA, $tankA] = $mk($branchA, $warehouseA, 'B2A');
        [$stationB, $tankB] = $mk($branchB, $warehouseB, 'B2B');
        $supplier = Partner::create(['branch_id' => $branchA->id, 'type' => 'supplier', 'name' => 'مورد B2', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI B2', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار B2'])->assertOk();

        return [
            'owner' => $auth['token'], 'fuel' => $fuel, 'supplier' => $supplier,
            'station_a' => $stationA, 'tank_a' => $tankA, 'warehouse_a' => $warehouseA,
            'station_b' => $stationB, 'tank_b' => $tankB, 'warehouse_b' => $warehouseB,
        ];
    }
}
