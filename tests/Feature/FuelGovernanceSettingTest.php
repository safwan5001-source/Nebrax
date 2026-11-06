<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
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
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B2 (إصلاح ثغرة التجاوز) — تغيير `fuel_distinct_approver_required` سلطة حوكمة مستقلة `fuel.governance.manage`:
 *  - من يملك `fuel_stations.manage` وحده (الصلاحية التشغيلية المعتادة) لا يستطيع تعطيل الضابط الذي يقيّده، بأي صيغة
 *    (false / true / مسح override / القيمة نفسها / ضمن طلب مختلط)، على المستأجر أو المحطة.
 *  - مفتاح الحوكمة إضافي لا بديل: لا يفتح مسار الإعدادات وحده.
 *  - لا تصعيد ذاتي عبر إدارة الأدوار والمستخدمين، والفحص في الخدمة (فاعل غائب مرفوض أيضاً).
 *  - بقية الإعدادات والأدوار القديمة كما كانت. حدود تاريخ التفعيل بالثانية.
 */
class FuelGovernanceSettingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';
    private const KEY = 'fuel_distinct_approver_required';

    private string $tenantId;

    // ───────────────────────── الفصل عن الصلاحية التشغيلية ─────────────────────────

    /** @test */
    public function an_operational_manager_cannot_change_the_policy_in_any_form_on_the_tenant_or_the_station(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');
        $before = $this->eventCount();

        foreach ([true, false] as $value) {
            $this->withToken($f['manager'])->putJson(self::BASE . '/settings', [self::KEY => $value])->assertForbidden();
        }
        // على المحطة تُقبل null (مسح override) في التحقق، فتُحكم هي أيضاً.
        foreach ([true, false, null] as $value) {
            $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => $value, 'reason' => 'محاولة'])->assertForbidden();
        }

        // لا قيمة تغيّرت ولا حدث تدقيق وُلد، والقرار الفعّال كما كان (محطة جديدة محمية).
        $this->assertSame($before, $this->eventCount());
        $this->assertNull(DB::table('fuel_station_setting_overrides')->where('setting_key', self::KEY)->first());
        $this->assertTrue($this->effective($f['station_new']));
        $this->assertFalse($this->effective($f['station_old']));
    }

    /** @test */
    public function clearing_an_existing_override_is_governed_too(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');
        $this->withToken($f['governor'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => true, 'reason' => 'تثبيت'])->assertOk();

        // مسح override المحطة (null) يضعف الضابط على محطة قديمة أو يعيد حسم الجديدة: محكوم كالكتابة.
        $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => null])->assertForbidden();
        $this->assertSame(1, DB::table('fuel_station_setting_overrides')->where('setting_key', self::KEY)->count());
    }

    /** @test */
    public function other_settings_stay_with_the_operational_permission_and_a_mixed_request_is_rejected_whole(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');

        // بقية الإعدادات كما كانت لمن يملك manage (لا تصعيد ولا تضييق).
        $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', ['shift_mandatory_cash_count' => false])->assertOk();
        $this->withToken($f['manager'])->putJson(self::BASE . '/settings', ['shift_mandatory_cash_count' => false])->assertOk();
        $this->assertFalse(app(FuelStationSettingsService::class)->forStation($f['station_new']->fresh())['shift_mandatory_cash_count']);

        // طلب مختلط: المفتاح المحكوم يُسقط الطلب كله فلا يُطبَّق الجزء المسموح.
        $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', ['shift_opening_cash_float_required' => false, self::KEY => false])->assertForbidden();
        $this->withToken($f['manager'])->putJson(self::BASE . '/settings', ['shift_opening_tank_reading_required' => false, self::KEY => false])->assertForbidden();
        $this->assertTrue(app(FuelStationSettingsService::class)->forStation($f['station_new']->fresh())['shift_opening_cash_float_required']);
        $this->assertTrue(app(FuelStationSettingsService::class)->forTenant()['shift_opening_tank_reading_required']);
    }

    /** @test */
    public function the_governance_permission_is_additional_not_a_substitute_for_the_settings_route(): void
    {
        $f = $this->fixture();

        $this->withToken($f['governance_only'])->putJson(self::BASE . '/settings', [self::KEY => false])->assertForbidden();
        $this->withToken($f['governance_only'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false])->assertForbidden();
        // ولا يفتح إعدادات أخرى (الحساب، السياسات التشغيلية) على أي مسار.
        $this->withToken($f['governance_only'])->putJson(self::BASE . '/settings', ['shift_mandatory_cash_count' => false])->assertForbidden();
    }

    /** @test */
    public function an_authorised_governor_can_change_it_and_every_change_is_audited_with_the_actor(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');
        $governorId = User::where('email', 'governor@fuel-gov.test')->value('id');

        $this->withToken($f['governor'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false, 'reason' => 'استثناء موثَّق'])->assertOk()->assertJsonPath('data.' . self::KEY, false);
        $this->withToken($f['governor'])->putJson(self::BASE . '/settings', [self::KEY => true, 'reason' => 'سياسة المؤسسة'])->assertOk();

        $events = DB::table('fuel_station_configuration_events')->where('setting_key', self::KEY)->orderBy('changed_at')->get();
        $this->assertCount(2, $events);
        $this->assertSame([$governorId, $governorId], $events->pluck('changed_by')->all());
        $this->assertEqualsCanonicalizing(['استثناء موثَّق', 'سياسة المؤسسة'], $events->pluck('reason')->all());
        $this->assertSame([$f['station_new']->id, null], [$events[0]->fuel_station_id, $events[1]->fuel_station_id]);

        // owner/admin عبر `*` يملكانها بلا منح.
        foreach (['owner', 'admin'] as $builtin) {
            $this->assertTrue(Rbac::allows($builtin, 'fuel.governance.manage'));
        }
        $this->withToken($f['admin'])->putJson(self::BASE . '/stations/' . $f['station_old']->id . '/settings', [self::KEY => true, 'reason' => 'مدير'])->assertOk();
        $this->withToken($f['owner'])->putJson(self::BASE . '/stations/' . $f['station_old']->id . '/settings', [self::KEY => null, 'reason' => 'مالك'])->assertOk();
    }

    /** @test */
    public function the_new_key_is_never_granted_implicitly_to_builtin_or_legacy_roles(): void
    {
        $this->assertContains('fuel.governance.manage', Rbac::PERMISSIONS);
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $this->assertFalse(Rbac::allows($role, 'fuel.governance.manage'), $role);
        }
        // الدور المخزَّن القديم بمفتاحَي الوقود الواسعين لا يرثه.
        $f = $this->fixture();
        $stored = Role::where('slug', 'fuel-gov-manager')->firstOrFail();
        $this->assertNotContains('fuel.governance.manage', $stored->permissions);
        $this->assertFalse(Rbac::allows('fuel-gov-manager', 'fuel.governance.manage'));
    }

    // ───────────────────────── لا تصعيد ذاتي ─────────────────────────

    /** @test */
    public function an_employee_who_manages_roles_and_users_cannot_grant_themselves_the_governance_key(): void
    {
        $f = $this->fixture();

        // إنشاء دور يحمل المفتاح، أو تعديل دورٍ لإضافته، أو إسناد دور المدير: كلها فوق سقف الفاعل (403).
        $this->withToken($f['role_admin'])->postJson('/api/roles', ['name' => 'تصعيد', 'permissions' => ['fuel_stations.manage', 'fuel.governance.manage']])->assertForbidden();
        $roleId = Role::where('slug', 'fuel-gov-role-admin')->value('id');
        $this->withToken($f['role_admin'])->putJson('/api/roles/' . $roleId, ['name' => 'تصعيد', 'permissions' => ['fuel_stations.manage', 'roles.manage', 'users.manage', 'fuel.governance.manage']])->assertForbidden();
        $selfId = User::where('email', 'role-admin@fuel-gov.test')->value('id');
        $this->withToken($f['role_admin'])->putJson('/api/users/' . $selfId, ['role' => 'admin'])->assertForbidden();

        $this->assertFalse(Rbac::allows('fuel-gov-role-admin', 'fuel.governance.manage'));
        // وصاحب الصلاحية يستطيع إنشاء دور يحملها (التحكم بالتفويض لا بالمفتاح نفسه).
        $this->withToken($f['owner'])->postJson('/api/roles', ['name' => 'حوكمة وقود', 'permissions' => ['fuel_stations.manage', 'fuel.governance.manage']])->assertCreated();
    }

    /** @test */
    public function disabling_the_policy_then_self_approving_is_impossible_through_the_usual_operational_permissions(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');

        $delivery = $this->withToken($f['manager'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, 'gov-chain-1'))->assertCreated()->json('data');

        // محاولات التعطيل بكل الطرق المتاحة له كلها تُرفض...
        $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id . '/settings', [self::KEY => false])->assertForbidden();
        $this->withToken($f['manager'])->putJson(self::BASE . '/settings', [self::KEY => false])->assertForbidden();
        // ...فيُرفض اعتماده لسجله، ولا أثر مخزني أو محاسبي.
        $response = $this->withToken($f['manager'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $delivery['id'])->value('status'));
        $this->assertSame(0, DB::table('stock_movements')->count());

        // معتمِد آخر يعتمدها؛ والقرار بيد الحوكمة وحدها.
        $this->withToken($f['governor'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();
    }

    /** @test */
    public function the_station_creation_date_cannot_be_edited_to_make_a_new_station_look_old(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-06-01T00:00:00Z');
        $createdAt = (string) DB::table('fuel_stations')->where('id', $f['station_new']->id)->value('created_at');

        $this->withToken($f['manager'])->putJson(self::BASE . '/stations/' . $f['station_new']->id, [
            'branch_id' => $f['station_new']->branch_id, 'warehouse_id' => $f['station_new']->warehouse_id, 'code' => $f['station_new']->code, 'name' => 'اسم مغيَّر',
            'created_at' => '2020-01-01 00:00:00',
        ]);

        $this->assertSame($createdAt, (string) DB::table('fuel_stations')->where('id', $f['station_new']->id)->value('created_at'));
        $this->assertTrue($this->effective($f['station_new']->fresh()));
    }

    // ───────────────────────── الفحص داخل الخدمة ─────────────────────────

    /** @test */
    public function the_service_itself_refuses_unauthorised_and_missing_actors_for_every_write_path(): void
    {
        $f = $this->fixture();
        $service = app(FuelStationSettingsService::class);
        $manager = User::where('email', 'manager@fuel-gov.test')->firstOrFail();
        $governor = User::where('email', 'governor@fuel-gov.test')->firstOrFail();

        $attempts = [
            'putTenant' => fn ($actor) => $service->putTenant([self::KEY => false], $actor),
            'putStationValues' => fn ($actor) => $service->putStationValues($f['station_new'], [self::KEY => false], $actor),
            'putStationValues(null)' => fn ($actor) => $service->putStationValues($f['station_new'], [self::KEY => null], $actor),
            'putStation' => fn ($actor) => $service->putStation($f['station_new'], self::KEY, false, $actor),
            'clearStation' => fn ($actor) => $service->clearStation($f['station_new'], self::KEY, $actor),
        ];
        foreach ($attempts as $name => $attempt) {
            foreach ([null, $manager] as $actor) {
                try {
                    $attempt($actor);
                    $this->fail("{$name} must refuse " . ($actor === null ? 'a missing actor' : 'an operational manager'));
                } catch (AuthorizationException) {
                    $this->addToAssertionCount(1);
                }
            }
        }
        $this->assertSame(0, DB::table('fuel_station_setting_overrides')->where('setting_key', self::KEY)->count());
        $this->assertSame(0, $this->eventCount());

        // المخوَّل ينجح، وغير المحكوم من المفاتيح لا يتأثر بغياب الفاعل (مسار النظام الحالي).
        $service->putStation($f['station_new'], self::KEY, false, $governor);
        $this->assertFalse($service->forStation($f['station_new']->fresh())[self::KEY]);
        $service->putStationValues($f['station_new'], ['shift_mandatory_cash_count' => false], null);
    }

    /** @test */
    public function nothing_outside_the_settings_service_writes_the_fuel_settings_group(): void
    {
        $offenders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php' || $file->getFilename() === 'FuelStationSettingsService.php') {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            if (preg_match("/Settings::put\(\s*(?:'fuel_stations'|\"fuel_stations\"|FuelStationSettingsService::GROUP|self::GROUP)/", $source) === 1 && str_contains($source, 'fuel_stations')) {
                $offenders[] = $file->getPathname();
            }
            if (str_contains($source, 'FuelStationSettingOverride::') && ! str_contains($file->getPathname(), 'FuelStationSettingsService') && preg_match('/FuelStationSettingOverride::(create|updateOrCreate|insert|upsert)/', $source) === 1) {
                $offenders[] = $file->getPathname();
            }
        }

        $this->assertSame([], $offenders, 'كتابة إعدادات الوقود تمرّ بالخدمة وحدها كي لا يُلتفّ على فحص الحوكمة');
    }

    // ───────────────────────── حدود تاريخ التفعيل ─────────────────────────

    /** @test */
    public function the_cutover_boundary_is_exact_to_the_second_and_instant_based(): void
    {
        $f = $this->fixture();
        $this->cutover('2026-11-06T00:00:00Z');
        $station = $f['station_old'];

        foreach ([
            '2026-11-05 23:59:59' => false,   // قبل الحدّ بثانية
            '2026-11-06 00:00:00' => true,    // الحدّ نفسه
            '2026-11-06 00:00:01' => true,    // بعده بثانية
            '2026-01-01 00:00:00' => false,
            '2027-01-01 00:00:00' => true,
        ] as $createdAt => $expected) {
            DB::table('fuel_stations')->where('id', $station->id)->update(['created_at' => $createdAt]);
            $this->assertSame($expected, $this->effective($station->fresh()), $createdAt);
        }

        // الحدّ بصيغة إزاحة يطابق اللحظة نفسها (03:00+03:00 = 00:00Z).
        $this->cutover('2026-11-06T03:00:00+03:00');
        DB::table('fuel_stations')->where('id', $station->id)->update(['created_at' => '2026-11-05 23:59:59']);
        $this->assertFalse($this->effective($station->fresh()));
        DB::table('fuel_stations')->where('id', $station->id)->update(['created_at' => '2026-11-06 00:00:00']);
        $this->assertTrue($this->effective($station->fresh()));
    }

    /** @test */
    public function a_station_created_through_the_api_follows_the_cutover_and_the_approved_date_is_the_default(): void
    {
        $f = $this->fixture();
        // التاريخ المعتمد من المالك هو الافتراضي في ملف الإعداد (يُقرأ الملف مباشرة لأن setUp الـtrait يعطّل الحدّ في الاختبارات).
        $defaults = require config_path('fuel_stations.php');
        $this->assertSame('2026-11-06T00:00:00Z', $defaults['distinct_approver_cutover_at'], 'التاريخ المعتمد هو الافتراضي في الإعداد');

        $create = fn (string $code) => $this->withToken($f['owner'])->postJson(self::BASE . '/stations', [
            'branch_id' => $f['station_new']->branch_id, 'warehouse_id' => $f['station_new']->warehouse_id, 'code' => $code, 'name' => 'محطة ' . $code,
        ])->assertCreated()->json('data.id');

        // حدّ في الماضي ⇒ محطة API الجديدة محمية؛ حدّ في المستقبل ⇒ لا (سلوك قائم حتى يحين الحدّ).
        $this->cutover(now()->subDay()->toIso8601String());
        $this->assertTrue($this->effective(FuelStation::findOrFail($create('FS-GOV-A'))));
        $this->cutover(now()->addDay()->toIso8601String());
        $this->assertFalse($this->effective(FuelStation::findOrFail($create('FS-GOV-B'))));
        // وقرار صريح للمحطة يغلب حتى حدّ المستقبل.
        $explicit = FuelStation::findOrFail($create('FS-GOV-C'));
        $this->withToken($f['governor'])->putJson(self::BASE . '/stations/' . $explicit->id . '/settings', [self::KEY => true, 'reason' => 'تفعيل صريح'])->assertOk();
        $this->assertTrue($this->effective($explicit->fresh()));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function cutover(?string $iso): void
    {
        config(['fuel_stations.distinct_approver_cutover_at' => $iso]);
    }

    private function eventCount(): int
    {
        return (int) DB::table('fuel_station_configuration_events')->where('setting_key', self::KEY)->count();
    }

    private function effective(FuelStation $station): bool
    {
        return app(FuelStationSettingsService::class)->forStation($station)[self::KEY];
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
    private function tokenFor(string $name, string $slug, ?array $permissions = null): string
    {
        app(TenantContext::class)->set($this->tenantId);
        if ($permissions !== null) {
            Role::create(['tenant_id' => $this->tenantId, 'slug' => $slug, 'name' => $name, 'permissions' => $permissions, 'is_system' => false]);
        }

        return User::create(['tenant_id' => $this->tenantId, 'name' => $name, 'email' => "{$name}@fuel-gov.test", 'password' => 'password123', 'role' => $slug])->createToken('api')->plainTextToken;
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-gov', 'owner@fuel-gov.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($this->tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b2_gov', reason: 'اختبار حوكمة فصل المعتمِد.',
        );
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouseNew = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseOld = Warehouse::create(['name' => 'مخزن قديم', 'code' => 'WH-GOV-OLD', 'branch_id' => $branch->id]);
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود حوكمة mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-GOV', 'name' => 'وقود حوكمة']);
        $mk = function (Warehouse $warehouse, string $code) use ($branch, $fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);

            return [$station, $tank];
        };
        [$stationNew, $tankNew] = $mk($warehouseNew, 'GNEW');
        [$stationOld, $tankOld] = $mk($warehouseOld, 'GOLD');
        DB::table('fuel_stations')->where('id', $stationOld->id)->update(['created_at' => '2026-01-01 00:00:00']);
        DB::table('fuel_stations')->where('id', $stationNew->id)->update(['created_at' => '2026-07-01 00:00:00']);

        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد حوكمة', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI حوكمة', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار الحوكمة'])->assertOk();

        $manage = ['fuel_stations.view', 'fuel_stations.manage'];

        return [
            'owner' => $auth['token'],
            'admin' => $this->tokenFor('admin', 'admin'),
            'manager' => $this->tokenFor('manager', 'fuel-gov-manager', $manage),
            'governor' => $this->tokenFor('governor', 'fuel-gov-governor', [...$manage, 'fuel.governance.manage']),
            'governance_only' => $this->tokenFor('govonly', 'fuel-gov-only', ['fuel.governance.manage']),
            'role_admin' => $this->tokenFor('role-admin', 'fuel-gov-role-admin', [...$manage, 'roles.view', 'roles.manage', 'users.view', 'users.manage']),
            'fuel' => $fuel, 'supplier' => $supplier,
            'station_new' => $stationNew->fresh(), 'tank_new' => $tankNew, 'warehouse_new' => $warehouseNew,
            'station_old' => $stationOld->fresh(), 'tank_old' => $tankOld,
        ];
    }
}
