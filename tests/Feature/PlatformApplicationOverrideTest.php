<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationEvent;
use App\Models\TenantApplicationState;
use App\Services\PlatformApplicationOverrideService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Services\TenantApplicationEntitlementResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformApplicationOverrideTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const COMMERCIAL_KEY = 'document_center.core';

    /** @return array{administrator: PlatformAdministrator, token: string} */
    private function platformAdministrator(array $abilities = ['platform:read', 'platform:manage']): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير تجاوزات التطبيقات',
            'email' => 'override+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            'administrator' => $administrator,
            'token' => $administrator->createToken('application-overrides', $abilities)->plainTextToken,
        ];
    }

    /** @test */
    public function platform_admin_grants_and_reverts_commercial_override_without_mutating_operational_state(): void
    {
        $tenant = $this->registerTenant('override-commercial', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/grant", [
                'application_key' => self::COMMERCIAL_KEY,
                'reason' => 'منح تجاوز إداري',
            ])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'applied')
            ->assertJsonPath('data.commercial_mode', 'granted');

        $grant = TenantApplicationEntitlement::sole();
        $this->assertSame(EntitlementSourceType::ADMINISTRATIVE_OVERRIDE->value, $grant->source_type);
        $this->assertSame(PlatformApplicationOverrideService::OVERRIDE_SOURCE_REFERENCE_TYPE, $grant->source_reference_type);
        $this->assertSame(
            PlatformApplicationOverrideService::overrideSourceReferenceId(self::COMMERCIAL_KEY),
            $grant->source_reference_id,
        );
        $this->assertSame(0, TenantApplicationState::count());

        app(TenantContext::class)->set($tenant['tenant_id']);
        $this->assertSame(
            TenantApplicationEntitlementDecision::FULL,
            app(TenantApplicationEntitlementResolver::class)->resolve(Tenant::findOrFail($tenant['tenant_id']), self::COMMERCIAL_KEY, now('UTC')),
        );

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/revert", [
                'application_key' => self::COMMERCIAL_KEY,
                'reason' => 'تراجع',
            ])
            ->assertOk()
            ->assertJsonPath('data.outcome', 'applied');

        $this->assertNotNull(TenantApplicationEntitlement::sole()->revoked_at);
        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id' => $tenant['tenant_id'],
            'action' => PlatformAdministratorAction::ACTION_APPLICATION_GRANTED,
        ]);
        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id' => $tenant['tenant_id'],
            'action' => PlatformAdministratorAction::ACTION_APPLICATION_REVERTED,
        ]);
    }

    /** @test */
    public function platform_admin_shows_and_hides_operational_capability_with_audit_actor(): void
    {
        $tenant = $this->registerTenant('override-operational', autoEnableApplications: false);
        $platform = $this->platformAdministrator();
        $key = 'hr.employees';

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/show", [
                'application_key' => $key,
                'reason' => 'إظهار من المنصة',
            ])
            ->assertOk()
            ->assertJsonPath('data.operational_status', 'enabled');

        $state = TenantApplicationState::sole();
        $this->assertSame('enabled', $state->status);
        $this->assertSame($platform['administrator']->id, $state->changed_by_platform_administrator_id);
        $this->assertNull($state->changed_by);

        $event = TenantApplicationEvent::sole();
        $this->assertSame('enabled', $event->action);
        $this->assertSame($platform['administrator']->id, $event->changed_by_platform_administrator_id);

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/hide", [
                'application_key' => $key,
            ])
            ->assertOk()
            ->assertJsonPath('data.operational_status', 'disabled');

        $this->assertDatabaseHas('platform_administrator_actions', [
            'action' => PlatformAdministratorAction::ACTION_APPLICATION_SHOWN,
        ]);
        $this->assertDatabaseHas('platform_administrator_actions', [
            'action' => PlatformAdministratorAction::ACTION_APPLICATION_HIDDEN,
        ]);
    }

    /** @test */
    public function mandatory_capability_cannot_be_hidden_by_platform(): void
    {
        $tenant = $this->registerTenant('override-mandatory');
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/hide", [
                'application_key' => 'sales.invoicing',
            ])
            ->assertStatus(422);
    }

    /** @test */
    public function preview_is_read_only_and_bulk_show_respects_dependency_order(): void
    {
        $tenant = $this->registerTenant('override-bulk', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/preview", [
                'action' => PlatformApplicationOverrideService::BULK_SHOW_ALL,
                'keys' => ['sales.pos', 'sales.invoicing'],
            ])
            ->assertOk()
            ->assertJsonPath('data.results.0.application_key', 'sales.invoicing')
            ->assertJsonPath('data.results.1.application_key', 'sales.pos');

        $this->assertSame(0, TenantApplicationState::count());

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/bulk", [
                'action' => PlatformApplicationOverrideService::BULK_SHOW_ALL,
                'keys' => ['sales.pos', 'sales.invoicing'],
            ])
            ->assertOk();

        app(TenantContext::class)->set($tenant['tenant_id']);
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('sales.invoicing'));
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('sales.pos'));
    }

    /** @test */
    public function commercial_applications_summary_includes_override_fields(): void
    {
        $tenant = $this->registerTenant('override-summary', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/grant", [
                'application_key' => self::COMMERCIAL_KEY,
            ])
            ->assertOk();

        $response = $this->withToken($platform['token'])
            ->getJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-applications")
            ->assertOk();

        $entry = collect($response->json('data.applications'))->firstWhere('key', self::COMMERCIAL_KEY);
        $this->assertSame('granted', $entry['commercial_mode']);
        $this->assertTrue($entry['can_revert']);
        $this->assertFalse($entry['can_grant']);
    }

    /** @test */
    public function tenant_users_cannot_access_platform_override_routes(): void
    {
        $tenant = $this->registerTenant('override-tenant-rbac');

        $this->withToken($tenant['token'])
            ->getJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/summary")
            ->assertForbidden();
    }

    /** @test */
    public function tenant_application_events_are_immutable(): void
    {
        $tenant = $this->registerTenant('override-immutable', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/show", [
                'application_key' => 'hr.employees',
            ])
            ->assertOk();

        $event = TenantApplicationEvent::sole();

        $this->expectException(\LogicException::class);
        $event->update(['reason' => 'tamper']);
    }
}
