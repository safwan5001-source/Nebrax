<?php

namespace Tests\Feature;

use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationSettingOverride;
use App\Services\FuelStationSettingsService;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR3 — سياسات تعبئة صهاريج المتعاملين (قرارات المالك 1/2/5 + اختيار الصهريج): الافتراضات المعتمدة، التحقق، الحوكمة (`fuel.governance.manage`)،
 * التدقيق، وراثة محطة ← مؤسسة، رفض override الجهاز، عزل المستأجر، وغياب أي أثر مالي/مخزني. الصلاحية الجديدة `fuel.shift.meter_variance_review` (قرار 8).
 */
class FuelTankerPolicySettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';
    private const KEYS = ['tanker_selection_required', 'tanker_voucher_unique_scope', 'tanker_capacity_overrun_policy'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildFixture();
    }

    /** @return array{0:int,1:int,2:int} */
    private function financialCounts(): array
    {
        return [(int) DB::table('stock_movements')->count(), (int) DB::table('journal_entries')->count(), (int) DB::table('fuel_operational_ledgers')->count()];
    }

    /** مدير يملك إعدادات المحطة فقط (بلا حوكمة). @return array{user: \App\Models\User, token: string} */
    private function manager(bool $governance = false): array
    {
        return $this->makeUser($governance ? 'gov' : 'mgr', $governance ? 'role-gov' : 'role-mgr', array_merge(['fuel_stations.view', 'fuel_stations.manage'], $governance ? ['fuel.governance.manage'] : []));
    }

    /** @test */
    public function defaults_are_the_owner_approved_values_at_tenant_and_station_level(): void
    {
        $tenant = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->assertOk()->json('data');
        $this->assertFalse($tenant['tanker_selection_required']);
        $this->assertSame('station', $tenant['tanker_voucher_unique_scope']);
        $this->assertSame('allow_with_confirmation', $tenant['tanker_capacity_overrun_policy']);

        $station = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings')->assertOk()->json('data');
        $this->assertFalse($station['tanker_selection_required']);
        $this->assertSame('station', $station['tanker_voucher_unique_scope']);

        $policy = app(FuelStationSettingsService::class)->tankerFillPolicy($this->fx['s1']);
        $this->assertSame(['selection_required' => false, 'voucher_unique_scope' => 'station', 'capacity_overrun_policy' => 'allow_with_confirmation'], $policy);
    }

    /** @test */
    public function an_authorised_actor_changes_tenant_policies_with_audit_and_stations_inherit_until_overridden(): void
    {
        $before = $this->financialCounts();
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', [
            'tanker_selection_required' => true, 'tanker_voucher_unique_scope' => 'tenant', 'tanker_capacity_overrun_policy' => 'block', 'reason' => 'سياسة تعبئة الصهاريج',
        ])->assertOk();

        $svc = app(FuelStationSettingsService::class);
        $this->assertSame(['selection_required' => true, 'voucher_unique_scope' => 'tenant', 'capacity_overrun_policy' => 'block'], $svc->tankerFillPolicy($this->fx['s1']));

        // override محطة يتقدّم؛ ومسحه يعيد وراثة المؤسسة.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tanker_voucher_unique_scope' => 'owner', 'reason' => 'محطة'])->assertOk();
        $this->assertSame('owner', $svc->tankerFillPolicy($this->fx['s1'])['voucher_unique_scope']);
        $this->assertSame('tenant', $svc->tankerFillPolicy($this->fx['s2'])['voucher_unique_scope']);
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tanker_voucher_unique_scope' => null, 'reason' => 'مسح'])->assertOk();
        $this->assertSame('tenant', $svc->tankerFillPolicy($this->fx['s1'])['voucher_unique_scope']);

        foreach (self::KEYS as $key) {
            $this->assertTrue(FuelStationConfigurationEvent::where('setting_key', $key)->exists(), "audit event for {$key}");
        }
        $this->assertSame($before, $this->financialCounts(), 'policies are stored only: no stock, ledger or entry');
    }

    /** @test */
    public function the_station_settings_response_tells_overridden_keys_from_inherited_ones_even_when_the_values_are_equal(): void
    {
        $url = self::BASE . '/stations/' . $this->fx['s1']->id . '/settings';
        $this->assertSame([], $this->withToken($this->fx['owner'])->getJson($url)->assertOk()->json('meta.overrides'));

        // تثبيت قيمة مساوية لقيمة المؤسسة (station = الافتراضي) هو تجاوز صريح لا وراثة.
        $put = $this->withToken($this->fx['owner'])->putJson($url, ['tanker_voucher_unique_scope' => 'station', 'reason' => 'تثبيت'])->assertOk();
        $this->assertSame(['tanker_voucher_unique_scope'], $put->json('meta.overrides'));
        $this->assertSame(['tanker_voucher_unique_scope'], $this->withToken($this->fx['owner'])->getJson($url)->json('meta.overrides'));

        // تغيّر المؤسسة لاحقاً لا يغيّر المحطة المثبَّتة، ويغيّر المحطة الأخرى الموروثة.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', ['tanker_voucher_unique_scope' => 'owner', 'reason' => 'x'])->assertOk();
        $svc = app(FuelStationSettingsService::class);
        $this->assertSame('station', $svc->tankerFillPolicy($this->fx['s1'])['voucher_unique_scope']);
        $this->assertSame('owner', $svc->tankerFillPolicy($this->fx['s2'])['voucher_unique_scope']);

        // المسح يعيد الوراثة؛ وتجاوز محطة لا يظهر في محطة أخرى.
        $this->assertSame([], $this->withToken($this->fx['owner'])->getJson(self::BASE . '/stations/' . $this->fx['s2']->id . '/settings')->json('meta.overrides'));
        $cleared = $this->withToken($this->fx['owner'])->putJson($url, ['tanker_voucher_unique_scope' => null, 'reason' => 'مسح'])->assertOk();
        $this->assertSame([], $cleared->json('meta.overrides'));
    }

    /** @test */
    public function invalid_values_are_rejected_and_supervisor_approval_is_not_supported_yet(): void
    {
        foreach ([
            ['tanker_voucher_unique_scope' => 'branch'],
            ['tanker_capacity_overrun_policy' => 'supervisor_approval'],
            ['tanker_capacity_overrun_policy' => 'whatever'],
            ['tanker_selection_required' => 'maybe'],
        ] as $payload) {
            $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', $payload + ['reason' => 'x'])->assertStatus(422);
            $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', $payload + ['reason' => 'x'])->assertStatus(422);
        }
        $this->assertFalse($this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->json('data.tanker_selection_required'));
    }

    /** @test */
    public function the_three_keys_are_governance_keys_a_manager_without_governance_is_refused_everywhere(): void
    {
        $manager = $this->manager(false);
        foreach ([
            ['tanker_selection_required' => true],
            ['tanker_voucher_unique_scope' => 'tenant'],
            ['tanker_capacity_overrun_policy' => 'block'],
        ] as $payload) {
            $this->withToken($manager['token'])->putJson(self::BASE . '/settings', $payload + ['reason' => 'x'])->assertForbidden();
            $this->withToken($manager['token'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', $payload + ['reason' => 'x'])->assertForbidden();
        }
        // مسح override (حتى بلا قيمة) محكوم أيضاً — لا التفاف بالمسح.
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tanker_voucher_unique_scope' => 'owner', 'reason' => 'x'])->assertOk();
        $this->withToken($manager['token'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tanker_voucher_unique_scope' => null, 'reason' => 'x'])->assertForbidden();
        $this->assertSame('owner', app(FuelStationSettingsService::class)->tankerFillPolicy($this->fx['s1'])['voucher_unique_scope']);

        $governance = $this->manager(true);
        $this->withToken($governance['token'])->putJson(self::BASE . '/settings', ['tanker_capacity_overrun_policy' => 'allow', 'reason' => 'حوكمة'])->assertOk();
        $this->assertSame('allow', app(FuelStationSettingsService::class)->tankerFillPolicy($this->fx['s1'])['capacity_overrun_policy']);

        // طلب مختلط (مفتاح عادي + مفتاح حوكمة) يُرفض كله بلا تطبيق جزئي.
        $this->withToken($manager['token'])->putJson(self::BASE . '/settings', ['shift_meter_tolerance_milliliters' => 77, 'tanker_selection_required' => true, 'reason' => 'x'])->assertForbidden();
        $this->assertNotSame(77, $this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->json('data.shift_meter_tolerance_milliliters'));
    }

    /** @test */
    public function device_level_overrides_are_refused_for_tanker_policies(): void
    {
        $svc = app(FuelStationSettingsService::class);
        foreach (self::KEYS as $key) {
            $value = $key === 'tanker_selection_required' ? true : ($key === 'tanker_voucher_unique_scope' ? 'owner' : 'block');
            try {
                $svc->putDevice($this->fx['s1'], 'terminal-1', $key, $value, null, 'x');
                $this->fail("device override accepted for {$key}");
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('override', $e->getMessage());
            }
        }
    }

    /** @test */
    public function a_corrupt_stored_value_falls_back_to_the_approved_default(): void
    {
        FuelStationSettingOverride::create(['tenant_id' => $this->tenantId, 'fuel_station_id' => $this->fx['s1']->id, 'device_key' => '', 'setting_key' => 'tanker_voucher_unique_scope', 'value' => 'garbage']);
        FuelStationSettingOverride::create(['tenant_id' => $this->tenantId, 'fuel_station_id' => $this->fx['s1']->id, 'device_key' => '', 'setting_key' => 'tanker_capacity_overrun_policy', 'value' => 'supervisor_approval']);
        $policy = app(FuelStationSettingsService::class)->tankerFillPolicy($this->fx['s1']);
        $this->assertSame('station', $policy['voucher_unique_scope']);
        $this->assertSame('allow_with_confirmation', $policy['capacity_overrun_policy']);
    }

    /** @test */
    public function another_tenant_never_sees_or_changes_these_policies(): void
    {
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', ['tanker_voucher_unique_scope' => 'owner', 'reason' => 'x'])->assertOk();

        $other = $this->registerTenant('fuel-pr3-b', 'owner@fuel-pr3-b.test', autoEnableApplications: true);
        // مستأجر آخر بلا قدرة fuel_stations.core ⇒ المسار مرفوض عنده، وإعداداته لا تتأثر بالأول.
        app(\App\Tenancy\TenantContext::class)->set($other['tenant_id']);
        $this->assertSame('station', app(FuelStationSettingsService::class)->forTenant()['tanker_voucher_unique_scope']);
        app(\App\Tenancy\TenantContext::class)->set($this->tenantId);
        $this->assertSame('owner', app(FuelStationSettingsService::class)->forTenant()['tanker_voucher_unique_scope']);
    }

    /** @test */
    public function the_meter_variance_review_permission_exists_is_reserved_and_separate_from_cash_variance_review(): void
    {
        $this->assertContains('fuel.shift.meter_variance_review', Rbac::PERMISSIONS);
        $this->assertContains('fuel.shift.cash_variance_review', Rbac::PERMISSIONS);
        $this->assertTrue(Rbac::allows('owner', 'fuel.shift.meter_variance_review'), 'owner/admin hold it through the wildcard');
        $this->assertFalse(Rbac::allows('staff', 'fuel.shift.meter_variance_review'));
        $this->assertFalse(Rbac::allows('accountant', 'fuel.shift.meter_variance_review'));
        foreach (array_keys(Rbac::MATRIX) as $role) {
            $this->assertNotContains('fuel.shift.meter_variance_review', Rbac::MATRIX[$role], "{$role} must not receive it implicitly");
        }
        foreach (FuelStaffTemplates::all() as $template) {
            $this->assertNotContains('fuel.shift.meter_variance_review', $template['permissions'] ?? [], 'no staff template grants it');
        }
    }
}
