<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Services\ApplicationAccessDecision;
use App\Services\CommercialAssignmentLifecycleService;
use App\Services\CommercialAssignmentService;
use App\Services\CommercialProductVersionService;
use App\Services\EntitlementGrantService;
use App\Services\TenantApplicationEntitlementResolver;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialAssignmentLifecycleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function publishedAddon(string $code, array $capabilities): CommercialProductVersion
    {
        $product = CommercialProduct::create(['code' => $code, 'name' => $code]);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $service = app(CommercialProductVersionService::class);
        $service->setCapabilities($version, $capabilities);

        return $service->publish($version);
    }

    private function assignment(Tenant $tenant, CommercialProductVersion $version): TenantCommercialAssignment
    {
        return app(CommercialAssignmentService::class)->assignAddon(
            $tenant,
            null,
            $version,
            CarbonImmutable::parse('2026-01-01T00:00:00Z'),
        );
    }

    /** @test */
    public function payment_grace_obeys_day_0_7_8_30_31_boundaries_and_denies_non_read_operations(): void
    {
        $auth = $this->registerTenant('grace-boundaries', 'owner@grace-boundaries.test', autoEnableApplications: true);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $assignment = $this->assignment($tenant, $this->publishedAddon('grace-hr', ['hr.employees']));
        $lifecycle = app(CommercialAssignmentLifecycleService::class);
        $lifecycle->recordPaymentFailure($assignment, null, CarbonImmutable::parse('2026-01-01T00:00:00Z'));
        $resolver = app(TenantApplicationEntitlementResolver::class);

        foreach ([0, 7] as $day) {
            $this->assertSame(TenantApplicationEntitlementDecision::FULL, $resolver->resolve($tenant, 'hr.employees', CarbonImmutable::parse("2026-01-01T00:00:00Z")->addDays($day)));
        }
        foreach ([8, 30] as $day) {
            $at = CarbonImmutable::parse('2026-01-01T00:00:00Z')->addDays($day);
            $this->assertSame(TenantApplicationEntitlementDecision::READ_ONLY, $resolver->resolve($tenant, 'hr.employees', $at));
            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(ApplicationAccessLevel::READ_ONLY, app(ApplicationAccessDecision::class)->decide($tenant, 'hr.employees', ApplicationOperationClass::READ, true, $at)->level);
            $this->assertSame(ApplicationAccessLevel::DENIED, app(ApplicationAccessDecision::class)->decide($tenant, 'hr.employees', ApplicationOperationClass::WRITE, true, $at)->level);
            $this->assertSame(ApplicationAccessLevel::DENIED, app(ApplicationAccessDecision::class)->decide($tenant, 'hr.employees', ApplicationOperationClass::TRANSITION, true, $at)->level);
            $this->assertSame(ApplicationAccessLevel::DENIED, app(ApplicationAccessDecision::class)->decide($tenant, 'hr.employees', ApplicationOperationClass::DESTRUCTIVE, true, $at)->level);
        }
        $this->assertSame(TenantApplicationEntitlementDecision::DENIED, $resolver->resolve($tenant, 'hr.employees', CarbonImmutable::parse('2026-02-01T00:00:00Z')));

        $lifecycle->reconcile($assignment, null, CarbonImmutable::parse('2026-01-09T00:00:00Z'));
        $this->assertDatabaseHas('tenant_commercial_assignments', ['id' => $assignment->id, 'lifecycle_state' => TenantCommercialAssignment::LIFECYCLE_GRACE_READ_ONLY]);
        $this->assertSame(0, TenantApplicationEntitlement::where('grant_group_id', $assignment->id)->where('access_mode', 'full')->whereNull('revoked_at')->count());
        $this->assertSame(1, TenantApplicationEntitlement::where('grant_group_id', $assignment->id)->where('access_mode', 'read_only')->whereNull('revoked_at')->count());
        $this->assertDatabaseHas('tenant_commercial_assignment_events', ['tenant_commercial_assignment_id' => $assignment->id, 'action' => TenantCommercialAssignmentEvent::ACTION_GRACE_READ_ONLY_STARTED]);
    }

    /** @test */
    public function a_full_legacy_source_wins_over_a_commercial_read_only_source_and_legacy_is_unchanged_after_expiry(): void
    {
        $auth = $this->registerTenant('lifecycle-union', 'owner@lifecycle-union.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $assignment = $this->assignment($tenant, $this->publishedAddon('union-hr', ['hr.employees']));
        $lifecycle = app(CommercialAssignmentLifecycleService::class);
        $lifecycle->recordPaymentFailure($assignment, null, CarbonImmutable::parse('2026-01-01T00:00:00Z'));
        app(TenantContext::class)->set($tenant->id);
        app(EntitlementGrantService::class)->grant(
            $tenant, 'hr.employees', EntitlementAccessMode::FULL, EntitlementSourceType::LEGACY_GRANDFATHER,
            CarbonImmutable::parse('2026-01-01T00:00:00Z'), null, 'legacy-backfill', $tenant->id, null, 'LEGACY_REACHABLE',
        );
        app(TenantContext::class)->forget();

        $at = CarbonImmutable::parse('2026-01-09T00:00:00Z');
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', $at));
        $lifecycle->reconcile($assignment, null, CarbonImmutable::parse('2026-02-01T00:00:00Z'));
        $this->assertSame(TenantCommercialAssignment::LIFECYCLE_ENDED_DENIED, $assignment->fresh()->lifecycle_state);
        $legacy = TenantApplicationEntitlement::where('source_type', EntitlementSourceType::LEGACY_GRANDFATHER->value)->sole();
        $this->assertNull($legacy->revoked_at);
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', CarbonImmutable::parse('2026-02-01T00:00:00Z')));
    }

    /** @test */
    public function scheduled_cancellation_ends_only_its_assignment_group_and_preserves_history(): void
    {
        $auth = $this->registerTenant('scheduled-cancel', 'owner@scheduled-cancel.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $assignment = $this->assignment($tenant, $this->publishedAddon('scheduled-hr', ['hr.employees']));
        $lifecycle = app(CommercialAssignmentLifecycleService::class);
        $scheduled = CarbonImmutable::parse('2026-01-10T00:00:00Z');
        $lifecycle->scheduleCancellation($assignment, null, $scheduled, 'تنتهي مع الفترة');

        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', $scheduled->subSecond()));
        $this->assertSame(TenantApplicationEntitlementDecision::DENIED, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', $scheduled));
        $lifecycle->reconcile($assignment, null, $scheduled);

        $this->assertSame('ended', $assignment->fresh()->status);
        $this->assertDatabaseHas('tenant_commercial_assignment_events', ['tenant_commercial_assignment_id' => $assignment->id, 'action' => TenantCommercialAssignmentEvent::ACTION_CANCELLATION_SCHEDULED]);
        $this->assertDatabaseHas('tenant_commercial_assignment_events', ['tenant_commercial_assignment_id' => $assignment->id, 'action' => TenantCommercialAssignmentEvent::ACTION_EXPIRED]);
        $this->assertNotNull(TenantApplicationEntitlement::where('grant_group_id', $assignment->id)->sole()->revoked_at);
    }

    /** @test */
    public function lifecycle_access_is_tenant_isolated_and_platform_lifecycle_routes_require_manage_ability(): void
    {
        $tenantA = $this->registerTenant('lifecycle-a', 'owner@lifecycle-a.test');
        $tenantB = $this->registerTenant('lifecycle-b', 'owner@lifecycle-b.test');
        $assignment = $this->assignment(Tenant::findOrFail($tenantA['tenant_id']), $this->publishedAddon('isolated-hr', ['hr.employees']));
        $admin = \App\Models\PlatformAdministrator::create(['name' => 'Lifecycle Admin', 'email' => 'lifecycle+' . uniqid() . '@nebrax.test', 'password' => 'platform-password-123']);
        $readOnly = $admin->createToken('lifecycle-read', ['platform:read'])->plainTextToken;

        $this->withToken($tenantB['token'])->postJson("/api/platform/commercial-assignments/{$assignment->id}/payment-failure", ['effective_at' => '2026-01-01T00:00:00Z'])->assertForbidden();
        $this->withToken($readOnly)->postJson("/api/platform/commercial-assignments/{$assignment->id}/payment-failure", ['effective_at' => '2026-01-01T00:00:00Z'])->assertForbidden();
        app(TenantContext::class)->set($tenantB['tenant_id']);
        $this->assertSame(0, TenantApplicationEntitlement::count());
    }
}
