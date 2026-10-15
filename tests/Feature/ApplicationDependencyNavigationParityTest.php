<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Services\ApplicationAccessDecision;
use App\Services\EntitlementGrantService;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationCatalog;
use App\Support\ApplicationOperationClass;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-BACKEND-NAV-02 — `GET /applications/nav-state` يحترم اعتماديات القدرات التجارية.
 *
 * حارس مسارات `fuel_stations.avi` يمرّ بـ`ApplicationAccessDecision` الذي يرفض عند رفض
 * `fuel_stations.core`، بينما كان `navVisibility()` يقيّم منحة المفتاح نفسه وحدها فيُظهر
 * رابط AVI/RFID لمستأجر يردّ مساره 403. هنا: الظهور الملاحي == قرار الحارس عبر منح مختلطة.
 */
class ApplicationDependencyNavigationParityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const AVI = 'fuel_stations.avi';
    private const CORE = 'fuel_stations.core';
    private const AVI_ROUTE = '/api/fuel-stations/avi-rfid/tags';

    private function grant(string $tenantId, string $key, EntitlementAccessMode $mode = EntitlementAccessMode::FULL): void
    {
        app(TenantContext::class)->set($tenantId);

        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId),
            $key,
            $mode,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            CarbonImmutable::now('UTC')->subMinute(),
            null,
            'nav-02-test',
            (string) Str::uuid(),
        );
    }

    /** @return array<string, bool> */
    private function navState(string $token): array
    {
        return $this->withToken($token)->getJson('/api/applications/nav-state')->assertOk()->json('data');
    }

    #[Test]
    public function avi_without_core_is_hidden_and_the_route_guard_refuses(): void
    {
        $auth = $this->registerTenant('nav02-avi-only');
        $this->grant($auth['tenant_id'], self::AVI);

        $nav = $this->navState($auth['token']);

        $this->assertFalse($nav[self::CORE], 'core بلا منحة.');
        $this->assertFalse($nav[self::AVI], 'AVI بمنحته وحدها لا يكفي: اعتماده core مرفوض.');
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertForbidden();
    }

    #[Test]
    public function avi_with_core_is_visible_and_the_route_opens(): void
    {
        $auth = $this->registerTenant('nav02-avi-core');
        $this->grant($auth['tenant_id'], self::CORE);
        $this->grant($auth['tenant_id'], self::AVI);

        $nav = $this->navState($auth['token']);

        $this->assertTrue($nav[self::CORE]);
        $this->assertTrue($nav[self::AVI]);
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertOk();
    }

    #[Test]
    public function core_alone_never_reveals_avi(): void
    {
        $auth = $this->registerTenant('nav02-core-only');
        $this->grant($auth['tenant_id'], self::CORE);

        $nav = $this->navState($auth['token']);

        $this->assertTrue($nav[self::CORE]);
        $this->assertFalse($nav[self::AVI]);
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertForbidden();
    }

    #[Test]
    public function a_read_only_dependency_keeps_the_link_for_reads_and_refuses_writes(): void
    {
        $auth = $this->registerTenant('nav02-core-read-only');
        $this->grant($auth['tenant_id'], self::CORE, EntitlementAccessMode::READ_ONLY);
        $this->grant($auth['tenant_id'], self::AVI);

        $this->assertTrue($this->navState($auth['token'])[self::AVI]);
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertOk();
        $this->withToken($auth['token'])->postJson(self::AVI_ROUTE, [])->assertForbidden();
    }

    #[Test]
    public function revoking_the_dependency_hides_the_link_again(): void
    {
        $auth = $this->registerTenant('nav02-core-revoked');
        $this->grant($auth['tenant_id'], self::CORE);
        $this->grant($auth['tenant_id'], self::AVI);
        $this->assertTrue($this->navState($auth['token'])[self::AVI]);

        TenantApplicationEntitlement::query()
            ->where('tenant_id', $auth['tenant_id'])
            ->where('capability_key', self::CORE)
            ->update(['revoked_at' => CarbonImmutable::now('UTC')->subSecond()]);

        $this->assertFalse($this->navState($auth['token'])[self::AVI]);
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertForbidden();
    }

    #[Test]
    public function a_disabled_dependency_application_hides_the_link_even_when_both_are_entitled(): void
    {
        // المستأجر جديد (بعد ENFORCEMENT_CUTOVER_AT) ولم تُفعَّل قدراته: لا صفّ حالة = معطّلة.
        $auth = $this->registerTenant('nav02-core-disabled', 'owner@nav02-core-disabled.test', autoEnableApplications: false);
        $this->grant($auth['tenant_id'], self::CORE);
        $this->grant($auth['tenant_id'], self::AVI);
        // AVI نفسها مفعّلة بصفّ صريح (خارج `enable()` الذي يرفض بلا اعتماد مفعَّل) وcore بلا صفّ.
        app(TenantContext::class)->set($auth['tenant_id']);
        TenantApplicationState::create(['application_key' => self::AVI, 'requested_enabled' => true, 'status' => 'enabled']);

        $nav = $this->navState($auth['token']);

        $this->assertFalse($nav[self::CORE], 'core معطّلة.');
        $this->assertFalse($nav[self::AVI], 'AVI مفعّلة ومستحقّة لكن اعتمادها معطّل.');
        $this->withToken($auth['token'])->getJson(self::AVI_ROUTE)->assertForbidden();
    }

    #[Test]
    public function dependency_state_never_leaks_across_tenants(): void
    {
        $a = $this->registerTenant('nav02-tenant-a', 'owner@nav02-a.test');
        $b = $this->registerTenant('nav02-tenant-b', 'owner@nav02-b.test');
        $this->grant($a['tenant_id'], self::CORE);
        $this->grant($a['tenant_id'], self::AVI);
        $this->grant($b['tenant_id'], self::AVI); // B: AVI بلا core

        $this->assertTrue($this->navState($a['token'])[self::AVI]);
        $this->assertFalse($this->navState($b['token'])[self::AVI]);
        $this->withToken($a['token'])->getJson(self::AVI_ROUTE)->assertOk();
        $this->withToken($b['token'])->getJson(self::AVI_ROUTE)->assertForbidden();
    }

    #[Test]
    public function rbac_stays_a_separate_gate_and_the_key_is_identical_for_every_role(): void
    {
        $auth = $this->registerTenant('nav02-roles');
        $this->grant($auth['tenant_id'], self::CORE);
        $this->grant($auth['tenant_id'], self::AVI);

        $ownerNav = $this->navState($auth['token']);
        $this->assertTrue($ownerNav[self::AVI]);

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'viewer', 'staff@nav02-roles.test');

        $this->assertSame($ownerNav, $this->navState($staffToken), 'nav-state لا يتغير بالدور.');
        $this->withToken($staffToken)->getJson(self::AVI_ROUTE)->assertForbidden(); // RBAC لا الاستحقاق
    }

    #[Test]
    public function non_dependent_commercial_keys_and_operational_keys_are_unchanged(): void
    {
        $auth = $this->registerTenant('nav02-unchanged');
        $this->grant($auth['tenant_id'], 'document_center.core');
        // sales.invoicing (إلزامية، بلا اعتماديات) تتبع منحتها وحدها كما في NAV-01.
        $nav = $this->navState($auth['token']);

        $this->assertTrue($nav['document_center.core']);
        $this->assertFalse($nav['sales.invoicing']);
        $this->assertArrayNotHasKey('accounting.ledger', $nav);
        // قدرة تشغيلية ذات اعتماديات (مفعّلة) تبقى ظاهرة — حارسها لا يقيّم الاعتماديات.
        $this->assertTrue($nav['sales.pos']);
    }

    #[Test]
    public function navigation_matches_the_route_guard_for_every_dependent_commercial_key_under_mixed_grants(): void
    {
        $dependent = array_keys(array_filter(
            ApplicationCatalog::all(),
            fn (array $application) => $application['access'] === ApplicationCatalog::ACCESS_COMMERCIAL
                && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT
                && $application['dependencies'] !== [],
        ));
        $this->assertContains(self::AVI, $dependent);

        $auth = $this->registerTenant('nav02-mixed');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $modes = [null, EntitlementAccessMode::READ_ONLY, EntitlementAccessMode::FULL];

        foreach ($dependent as $key) {
            // التبعيات التجارية المباشرة لهذا المفتاح (core للوقود).
            $commercialDeps = array_values(array_filter(
                ApplicationCatalog::dependenciesFor($key),
                fn (string $dep) => ApplicationCatalog::accessGateFor($dep) === ApplicationCatalog::ACCESS_COMMERCIAL,
            ));

            foreach ($modes as $ownMode) {
                foreach ($modes as $depMode) {
                    DB::table('tenant_application_entitlements')->where('tenant_id', $tenant->id)->delete();
                    if ($ownMode !== null) {
                        $this->grant($tenant->id, $key, $ownMode);
                    }
                    if ($depMode !== null) {
                        foreach ($commercialDeps as $dep) {
                            $this->grant($tenant->id, $dep, $depMode);
                        }
                    }

                    $nav = $this->navState($auth['token']);
                    app(TenantContext::class)->set($tenant->id);
                    $decision = app(ApplicationAccessDecision::class)->decide($tenant, $key, ApplicationOperationClass::READ);

                    $label = sprintf('%s own=%s dep=%s', $key, $ownMode?->value ?? 'none', $depMode?->value ?? 'none');
                    $this->assertSame($decision->level !== ApplicationAccessLevel::DENIED, $nav[$key], $label.': الشريط والحارس مختلفان.');
                }
            }
        }
    }
}
