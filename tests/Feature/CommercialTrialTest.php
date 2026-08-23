<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Services\CommercialApplicationStatusService;
use App\Services\CommercialAssignmentLifecycleService;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use App\Services\CommercialTrialService;
use App\Services\TenantApplicationEntitlementResolver;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialTrialTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function publishedProduct(string $code, array $capabilities): CommercialProductVersion
    {
        $product = CommercialProduct::create(['code' => $code, 'name' => $code]);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($version, $capabilities);

        return $products->publish($version);
    }

    private function publishedPlan(CommercialProductVersion ...$products): CommercialPlanVersion
    {
        $plan = CommercialPlanVersion::create(['plan_code' => 'trial-plan-' . uniqid(), 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, $products);

        return $plans->publish($plan);
    }

    /** @test */
    public function a_product_trial_is_version_pinned_materialized_as_trial_and_expires_without_touching_application_state(): void
    {
        $auth = $this->registerTenant('trial-product', 'owner@trial-product.test', autoEnableApplications: true);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $version = $this->publishedProduct('trial-hr', ['hr.employees']);
        $start = CarbonImmutable::parse('2026-01-01T00:00:00Z');
        $assignment = app(CommercialTrialService::class)->startAddonTrial($tenant, null, $version, $start, 14, 'validated trial');

        $this->assertSame(TenantCommercialAssignment::SOURCE_TRIAL, $assignment->source_type);
        $this->assertSame($version->id, $assignment->commercial_product_version_id);
        $this->assertEquals($start->addDays(14), $assignment->ends_at);
        $grant = TenantApplicationEntitlement::sole();
        $this->assertSame(EntitlementSourceType::TRIAL->value, $grant->source_type);
        $this->assertSame('commercial-product-version', $grant->source_reference_type);
        $this->assertSame($version->id, $grant->source_reference_id);
        $this->assertSame($assignment->id, $grant->grant_group_id);
        $this->assertDatabaseHas('tenant_commercial_assignment_events', ['tenant_commercial_assignment_id' => $assignment->id, 'action' => TenantCommercialAssignmentEvent::ACTION_TRIAL_STARTED]);
        $resolver = app(TenantApplicationEntitlementResolver::class);
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, $resolver->resolve($tenant, 'hr.employees', $start->addDays(13)));
        $this->assertSame(TenantApplicationEntitlementDecision::DENIED, $resolver->resolve($tenant, 'hr.employees', $start->addDays(14)));
        app(CommercialAssignmentLifecycleService::class)->reconcile($assignment, null, $start->addDays(14));
        $this->assertSame(TenantCommercialAssignment::LIFECYCLE_EXPIRED, $assignment->fresh()->lifecycle_state);
        $this->assertNotNull($grant->fresh()->revoked_at);
    }

    /** @test */
    public function plan_trial_materializes_only_its_pinned_products_and_duplicate_or_unbuilt_trials_are_rejected(): void
    {
        $auth = $this->registerTenant('trial-plan', 'owner@trial-plan.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $included = $this->publishedProduct('trial-plan-hr', ['hr.employees']);
        $plan = $this->publishedPlan($included);
        $service = app(CommercialTrialService::class);
        $service->startPlanTrial($tenant, null, $plan, CarbonImmutable::parse('2026-01-01T00:00:00Z'), 7);
        $this->assertSame(1, TenantApplicationEntitlement::count());
        $this->assertSame(EntitlementSourceType::TRIAL->value, TenantApplicationEntitlement::sole()->source_type);
        $this->expectException(\Illuminate\Validation\ValidationException::class);
        $service->startPlanTrial($tenant, null, $plan, CarbonImmutable::parse('2026-02-01T00:00:00Z'), 7);
    }

    /** @test */
    public function another_active_source_wins_when_trial_expires_and_trial_projection_includes_end_date(): void
    {
        $auth = $this->registerTenant('trial-overlap', 'owner@trial-overlap.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $version = $this->publishedProduct('trial-overlap-hr', ['hr.employees']);
        $start = now('UTC')->subDay();
        $trial = app(CommercialTrialService::class)->startAddonTrial($tenant, null, $version, $start, 14);
        $projection = app(CommercialApplicationStatusService::class)->forTenant($tenant)['hr.employees']['commercial'];
        $this->assertSame('trial', $projection['availability']);
        $this->assertNotNull($projection['trial_until']);

        app(\App\Services\CommercialAssignmentService::class)->assignAddon($tenant, null, $version, $start, null);
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', $start->addDays(14)));
        app(CommercialAssignmentLifecycleService::class)->reconcile($trial, null, $start->addDays(14));
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve($tenant, 'hr.employees', $start->addDays(14)));
    }

    /** @test */
    public function trial_endpoints_are_platform_admin_only_and_tenant_scoped(): void
    {
        $tenantA = $this->registerTenant('trial-a', 'owner@trial-a.test');
        $tenantB = $this->registerTenant('trial-b', 'owner@trial-b.test');
        $version = $this->publishedProduct('trial-api-hr', ['hr.employees']);
        $admin = PlatformAdministrator::create(['name' => 'Trial Admin', 'email' => 'trial+' . uniqid() . '@nebrax.test', 'password' => 'platform-password-123']);
        $token = $admin->createToken('trial-manage', ['platform:manage'])->plainTextToken;
        $payload = ['version_id' => $version->id, 'duration_days' => 7, 'starts_at' => '2026-01-01T00:00:00Z'];

        $this->withToken($tenantA['token'])->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-trials/addon", $payload)->assertForbidden();
        $this->withToken($token)->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-trials/addon", $payload)->assertCreated();
        $this->assertDatabaseMissing('tenant_commercial_assignments', ['tenant_id' => $tenantB['tenant_id'], 'source_type' => TenantCommercialAssignment::SOURCE_TRIAL]);
    }
}
