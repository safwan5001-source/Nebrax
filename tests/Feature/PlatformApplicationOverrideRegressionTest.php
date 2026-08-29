<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Services\PlatformApplicationOverrideService;
use App\Services\TenantApplicationService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformApplicationOverrideRegressionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CENTER = 'document_center.core';

    /** @return array{administrator: PlatformAdministrator, token: string} */
    private function platformAdministrator(): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير الانحدار',
            'email' => 'override-regression+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            'administrator' => $administrator,
            'token' => $administrator->createToken('override-regression', ['platform:read', 'platform:manage'])->plainTextToken,
        ];
    }

    /** @test */
    public function nav_state_reflects_platform_override_grant(): void
    {
        $auth = $this->registerTenant('nav-override', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $initial = $this->withToken($auth['token'])
            ->getJson('/api/applications/nav-state')
            ->assertOk();
        $this->assertFalse($initial['data'][self::CENTER]);

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$auth['tenant_id']}/application-overrides/grant", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        $afterGrant = $this->withToken($auth['token'])
            ->getJson('/api/applications/nav-state')
            ->assertOk();
        $this->assertFalse($afterGrant['data'][self::CENTER]);

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$auth['tenant_id']}/application-overrides/show", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        $response = $this->withToken($auth['token'])
            ->getJson('/api/applications/nav-state')
            ->assertOk();

        $this->assertTrue($response['data'][self::CENTER]);
    }

    /** @test */
    public function platform_grant_does_not_bypass_tenant_rbac_on_routes(): void
    {
        $auth = $this->registerTenant('override-rbac', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$auth['tenant_id']}/application-overrides/grant", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$auth['tenant_id']}/application-overrides/show", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@override-rbac.test');

        $this->withToken($staffToken)
            ->postJson('/api/document-batches', ['document_type' => 'expense'])
            ->assertForbidden();
    }

    /** @test */
    public function override_grant_is_tenant_isolated(): void
    {
        $tenantA = $this->registerTenant('override-iso-a', 'owner+' . uniqid() . '@override-iso-a.test', autoEnableApplications: false);
        $tenantB = $this->registerTenant('override-iso-b', 'owner+' . uniqid() . '@override-iso-b.test', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/application-overrides/grant", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        app(TenantContext::class)->set($tenantA['tenant_id']);
        $this->assertSame(1, \App\Models\TenantApplicationEntitlement::count());

        app(TenantContext::class)->set($tenantB['tenant_id']);
        $this->assertSame(0, \App\Models\TenantApplicationEntitlement::count());
    }

    /** @test */
    public function hiding_operational_app_blocks_nav_even_with_entitlement(): void
    {
        $auth = $this->registerTenant('override-hide-nav', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        app(TenantContext::class)->set($auth['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            self::CENTER,
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADMINISTRATIVE_OVERRIDE,
            now('UTC')->subMinute(),
            null,
            PlatformApplicationOverrideService::OVERRIDE_SOURCE_REFERENCE_TYPE,
            PlatformApplicationOverrideService::overrideSourceReferenceId(self::CENTER),
            null,
            'platform_override',
            null,
            $platform['administrator']->id,
        );
        app(TenantApplicationService::class)->enableForPlatform(self::CENTER, $platform['administrator']);
        app(TenantContext::class)->forget();

        $response = $this->withToken($auth['token'])
            ->getJson('/api/applications/nav-state')
            ->assertOk();

        $this->assertTrue($response['data'][self::CENTER]);

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$auth['tenant_id']}/application-overrides/hide", [
                'application_key' => self::CENTER,
            ])
            ->assertOk();

        $hidden = $this->withToken($auth['token'])
            ->getJson('/api/applications/nav-state')
            ->assertOk();
        $this->assertFalse($hidden['data'][self::CENTER]);
    }
}
