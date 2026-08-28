<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ApplicationNavStateEntitlementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CENTER = 'document_center.core';

    private function grantCenter(
        string $tenantId,
        EntitlementSourceType $source = EntitlementSourceType::ADDON,
        EntitlementAccessMode $mode = EntitlementAccessMode::FULL,
    ): void {
        app(TenantContext::class)->set($tenantId);

        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId),
            self::CENTER,
            $mode,
            $source,
            CarbonImmutable::now('UTC')->subMinute(),
            null,
            'nav-state-test',
            (string) Str::uuid(),
        );
    }

    /** @test */
    public function a_commercially_gated_capability_stays_hidden_without_any_entitlement(): void
    {
        $auth = $this->registerTenant('nav-entitlement');

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertFalse($response['data'][self::CENTER]);
        $this->assertArrayNotHasKey('applications', $response->json());
    }

    /** @test */
    public function an_active_entitlement_makes_the_capability_visible(): void
    {
        $auth = $this->registerTenant('nav-entitled');
        $this->grantCenter($auth['tenant_id']);

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertTrue($response['data'][self::CENTER]);
    }

    /** @test */
    public function a_read_only_entitlement_still_shows_the_link(): void
    {
        $auth = $this->registerTenant('nav-read-only');
        $this->grantCenter($auth['tenant_id'], EntitlementSourceType::TRIAL, EntitlementAccessMode::READ_ONLY);

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertTrue($response['data'][self::CENTER]);
    }

    /** @test */
    public function disabling_the_capability_hides_it_even_with_a_live_entitlement(): void
    {
        $auth = $this->registerTenant('nav-disabled-entitled');
        $this->grantCenter($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson('/api/applications/disable', ['application_key' => self::CENTER])
            ->assertOk();

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertFalse($response['data'][self::CENTER]);
    }

    /** @test */
    public function operational_capabilities_are_never_gated_by_entitlement_in_navigation(): void
    {
        $auth = $this->registerTenant('nav-operational');

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        foreach (['inventory.core', 'hr.employees', 'purchases.cycle', 'finance.operations', 'sales.pos'] as $key) {
            $this->assertTrue($response['data'][$key], "{$key} حُجب بلا بوابة تجارية تحرسه.");
        }
    }

    /** @test */
    public function suspended_capabilities_remain_visible_because_reading_stays_allowed(): void
    {
        $auth = $this->registerTenant('nav-suspended');
        app(TenantContext::class)->set($auth['tenant_id']);
        Employee::create(['employee_no' => 'EMP-NAV-1', 'name' => 'موظف الظهور']);

        $this->withToken($auth['token'])
            ->postJson('/api/applications/disable', ['application_key' => 'hr.employees'])
            ->assertOk()
            ->assertJsonPath('data.status', 'suspended');

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertTrue($response['data']['hr.employees']);
    }

    /** @test */
    public function mandatory_and_unbuilt_capabilities_stay_out_of_the_navigation_contract(): void
    {
        $auth = $this->registerTenant('nav-contract');

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertArrayNotHasKey('sales.invoicing', $response['data']);
        $this->assertArrayNotHasKey('accounting.ledger', $response['data']);
        $this->assertArrayNotHasKey('hr.payroll', $response['data']);
    }

    /** @test */
    public function navigation_visibility_never_leaks_across_tenants(): void
    {
        $entitled = $this->registerTenant('nav-tenant-a', 'owner@nav-tenant-a.test');
        $bare = $this->registerTenant('nav-tenant-b', 'owner@nav-tenant-b.test');
        $this->grantCenter($entitled['tenant_id']);

        $entitledNav = $this->withToken($entitled['token'])->getJson('/api/applications/nav-state')->assertOk();
        $bareNav = $this->withToken($bare['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertTrue($entitledNav['data'][self::CENTER]);
        $this->assertFalse($bareNav['data'][self::CENTER]);
    }

    /** @test */
    public function a_grandfathered_tenant_without_a_state_row_still_needs_an_entitlement(): void
    {
        $auth = $this->registerTenant('nav-grandfathered', 'owner@nav-grandfathered.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::findOrFail($auth['tenant_id'])->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        $this->assertDatabaseMissing('tenant_application_states', ['application_key' => self::CENTER]);

        $before = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();
        $this->assertFalse($before['data'][self::CENTER]);

        $this->grantCenter($auth['tenant_id']);

        $after = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();
        $this->assertTrue($after['data'][self::CENTER]);
    }

    /** @test */
    public function every_role_reads_the_same_navigation_contract(): void
    {
        $auth = $this->registerTenant('nav-roles');
        $this->grantCenter($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@nav-roles.test');

        $response = $this->withToken($staff)->getJson('/api/applications/nav-state')->assertOk();

        $this->assertTrue($response['data'][self::CENTER]);
        $this->withToken($staff)->getJson('/api/document-batches')->assertForbidden();
    }

    /** @test */
    public function a_revoked_entitlement_hides_the_capability_again(): void
    {
        $auth = $this->registerTenant('nav-revoked');
        $this->grantCenter($auth['tenant_id']);

        TenantApplicationEntitlement::query()
            ->where('tenant_id', $auth['tenant_id'])
            ->where('capability_key', self::CENTER)
            ->update(['revoked_at' => CarbonImmutable::now('UTC')->subSecond()]);

        $response = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk();

        $this->assertFalse($response['data'][self::CENTER]);
        $this->assertDatabaseHas('tenant_application_states', ['application_key' => self::CENTER, 'status' => 'enabled']);
    }
}
