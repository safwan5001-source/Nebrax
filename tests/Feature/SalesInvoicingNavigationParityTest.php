<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
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
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AWJ-BACKEND-NAV-01 — `GET /applications/nav-state` يطابق حارس المسارات لـ`sales.invoicing`.
 *
 * القدرة إلزامية (لا تُوقَف) لكن مسارات سندات التسليم تحرسها
 * `EnsureCommercialApplicationAccess:sales.invoicing`. كان العقد يُسقط كل قدرة إلزامية،
 * والواجهة تقرأ الغياب «ظاهرة دائماً»، فظهر رابط سندات التسليم لمستأجر بلا استحقاق
 * ويردّ مساره 403. هنا: الظهور الملاحي == قرار الحارس، لكل حالات الاستحقاق ولكل مستأجر.
 */
class SalesInvoicingNavigationParityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const KEY = 'sales.invoicing';

    private function grant(string $tenantId, EntitlementAccessMode $mode = EntitlementAccessMode::FULL, ?string $key = null): void
    {
        app(TenantContext::class)->set($tenantId);

        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId),
            $key ?? self::KEY,
            $mode,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            CarbonImmutable::now('UTC')->subMinute(),
            null,
            'nav-01-test',
            (string) Str::uuid(),
        );
    }

    /** @return array<string, bool> */
    private function navState(string $token): array
    {
        return $this->withToken($token)->getJson('/api/applications/nav-state')->assertOk()->json('data');
    }

    /** @test */
    public function an_unentitled_tenant_gets_a_hidden_key_and_the_route_guard_agrees(): void
    {
        $auth = $this->registerTenant('nav01-bare');

        $nav = $this->navState($auth['token']);

        $this->assertArrayHasKey(self::KEY, $nav, 'القدرة الإلزامية المحروسة تجارياً يجب أن تظهر في العقد، لا أن تغيب.');
        $this->assertFalse($nav[self::KEY]);
        $this->withToken($auth['token'])->getJson('/api/delivery-notes')->assertForbidden();
    }

    /** @test */
    public function the_mandatory_invoicing_surface_itself_is_never_hidden_by_this_key(): void
    {
        // المفتاح يحرس سندات التسليم وحدها؛ الفواتير مسار إلزامي لا يمرّ بالحارس التجاري.
        $auth = $this->registerTenant('nav01-invoices');

        $this->assertFalse($this->navState($auth['token'])[self::KEY]);
        $this->withToken($auth['token'])->getJson('/api/invoices')->assertOk();
    }

    /** @test */
    public function a_full_entitlement_shows_the_link_and_opens_the_route(): void
    {
        $auth = $this->registerTenant('nav01-full');
        $this->grant($auth['tenant_id']);

        $this->assertTrue($this->navState($auth['token'])[self::KEY]);
        $this->withToken($auth['token'])->getJson('/api/delivery-notes')->assertOk();
    }

    /** @test */
    public function a_read_only_entitlement_shows_the_link_reads_and_still_refuses_writes(): void
    {
        $auth = $this->registerTenant('nav01-read-only');
        $this->grant($auth['tenant_id'], EntitlementAccessMode::READ_ONLY);

        $this->assertTrue($this->navState($auth['token'])[self::KEY]);
        $this->withToken($auth['token'])->getJson('/api/delivery-notes')->assertOk();
        $this->withToken($auth['token'])->postJson('/api/delivery-notes', [])->assertForbidden();
    }

    /** @test */
    public function a_revoked_entitlement_hides_the_link_again(): void
    {
        $auth = $this->registerTenant('nav01-revoked');
        $this->grant($auth['tenant_id']);
        $this->assertTrue($this->navState($auth['token'])[self::KEY]);

        TenantApplicationEntitlement::query()
            ->where('tenant_id', $auth['tenant_id'])
            ->where('capability_key', self::KEY)
            ->update(['revoked_at' => CarbonImmutable::now('UTC')->subSecond()]);

        $this->assertFalse($this->navState($auth['token'])[self::KEY]);
        $this->withToken($auth['token'])->getJson('/api/delivery-notes')->assertForbidden();
    }

    /** @test */
    public function application_state_rows_never_decide_a_mandatory_key(): void
    {
        // الإلزامية «مفعّلة دائماً» كما في statusFor(): صفّ حالة شاذّ أو مستأجر قديم بلا صفوف
        // لا يُخفي القدرة عن مستأجر مستحقّ، ولا يُظهرها لغير المستحقّ.
        $legacy = $this->registerTenant('nav01-legacy', 'owner@nav01-legacy.test', autoEnableApplications: false);
        app(TenantContext::class)->set($legacy['tenant_id']);
        Tenant::findOrFail($legacy['tenant_id'])->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();
        $this->assertFalse($this->navState($legacy['token'])[self::KEY]);

        $fresh = $this->registerTenant('nav01-fresh', 'owner@nav01-fresh.test', autoEnableApplications: false);
        $this->grant($fresh['tenant_id']);
        $this->assertDatabaseMissing('tenant_application_states', ['tenant_id' => $fresh['tenant_id'], 'application_key' => self::KEY]);
        $this->assertTrue($this->navState($fresh['token'])[self::KEY]);

        $this->withToken($fresh['token'])
            ->postJson('/api/applications/disable', ['application_key' => self::KEY])
            ->assertStatus(422);
        $this->assertTrue($this->navState($fresh['token'])[self::KEY]);
    }

    /** @test */
    public function visibility_never_leaks_across_tenants(): void
    {
        $entitled = $this->registerTenant('nav01-tenant-a', 'owner@nav01-tenant-a.test');
        $bare = $this->registerTenant('nav01-tenant-b', 'owner@nav01-tenant-b.test');
        $this->grant($entitled['tenant_id']);

        $this->assertTrue($this->navState($entitled['token'])[self::KEY]);
        $this->assertFalse($this->navState($bare['token'])[self::KEY]);
        $this->withToken($bare['token'])->getJson('/api/delivery-notes')->assertForbidden();
        $this->withToken($entitled['token'])->getJson('/api/delivery-notes')->assertOk();
    }

    /** @test */
    public function every_role_reads_the_same_key_and_rbac_stays_a_separate_gate(): void
    {
        $auth = $this->registerTenant('nav01-roles');
        $this->grant($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@nav01-roles.test');

        $this->assertTrue($this->navState($staff)[self::KEY]);
        $this->assertSame($this->navState($auth['token']), $this->navState($staff));
    }

    /** @test */
    public function mandatory_operational_and_unbuilt_capabilities_stay_out_of_the_contract(): void
    {
        $auth = $this->registerTenant('nav01-contract');
        $nav = $this->navState($auth['token']);

        foreach (ApplicationCatalog::all() as $key => $application) {
            $expected = $application['maturity'] === ApplicationCatalog::MATURITY_BUILT
                && (! $application['mandatory'] || $application['access'] === ApplicationCatalog::ACCESS_COMMERCIAL);
            $this->assertSame($expected, array_key_exists($key, $nav), "{$key}: حضوره في العقد لا يطابق القاعدة.");
        }

        $this->assertArrayNotHasKey('accounting.ledger', $nav);
        $this->assertArrayNotHasKey('crm.customers', $nav);
        $this->assertArrayNotHasKey('hr.payroll', $nav);
    }

    /** @test */
    public function navigation_matches_the_route_guard_for_every_commercial_key_under_uniform_grants(): void
    {
        // حارس شامل: لكل قدرة محروسة تجارياً، «ظاهرة في الشريط» ⇔ «قرار القراءة ليس DENIED»،
        // في ثلاث حالات استحقاق **متجانسة** (المنحة نفسها لكل القدرات). لا يغطّي المنح المختلطة
        // عبر الاعتماديات: `navVisibility()` لا تقيّم الاعتماديات والحارس يقيّمها — فجوةٌ سابقة
        // لا تمسّ `sales.invoicing` (بلا اعتماديات)، موثّقة في تقرير NAV-01 كمهمة مستقلة.
        $commercial = array_keys(array_filter(
            ApplicationCatalog::all(),
            fn (array $application) => $application['access'] === ApplicationCatalog::ACCESS_COMMERCIAL,
        ));
        $this->assertContains(self::KEY, $commercial);

        foreach (['none' => null, 'full' => EntitlementAccessMode::FULL, 'read-only' => EntitlementAccessMode::READ_ONLY] as $label => $mode) {
            $auth = $this->registerTenant("nav01-parity-{$label}", "owner@nav01-parity-{$label}.test");
            if ($mode !== null) {
                foreach ($commercial as $key) {
                    $this->grant($auth['tenant_id'], $mode, $key);
                }
            }

            $nav = $this->navState($auth['token']);
            app(TenantContext::class)->set($auth['tenant_id']);
            $tenant = Tenant::findOrFail($auth['tenant_id']);

            foreach ($commercial as $key) {
                $decision = app(ApplicationAccessDecision::class)->decide($tenant, $key, ApplicationOperationClass::READ);
                $this->assertSame(
                    $decision->level !== ApplicationAccessLevel::DENIED,
                    $nav[$key],
                    "{$key} ({$label}): الشريط والحارس مختلفان.",
                );
            }
        }
    }
}
