<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Services\TenantApplicationEntitlementResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialAssignmentTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{administrator: PlatformAdministrator,token:string} */
    private function platformAdministrator(array $abilities = ['platform:read', 'platform:manage']): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مشغّل الإسنادات التجارية',
            'email' => 'commercial+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return ['administrator' => $administrator, 'token' => $administrator->createToken('commercial-assignments', $abilities)->plainTextToken];
    }

    /** @return array{CommercialPlanVersion, CommercialProductVersion} */
    private function publishedPlan(string $planCode, array $capabilities): array
    {
        $product = CommercialProduct::create(['code' => 'product-' . $planCode, 'name' => 'منتج ' . $planCode]);
        $productVersion = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($productVersion, $capabilities);
        $products->publish($productVersion);

        $plan = CommercialPlanVersion::create(['plan_code' => $planCode, 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$productVersion]);

        return [$plans->publish($plan), $productVersion];
    }

    /** @return CommercialProductVersion */
    private function publishedAddon(string $code, array $capabilities): CommercialProductVersion
    {
        $product = CommercialProduct::create(['code' => $code, 'name' => $code]);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($version, $capabilities);

        return $products->publish($version);
    }

    /** @test */
    public function platform_admin_assigns_a_pinned_plan_version_without_mutating_application_state(): void
    {
        $tenant = $this->registerTenant('commercial-plan', 'owner@commercial-plan.test', autoEnableApplications: false);
        [$plan] = $this->publishedPlan('starter', ['hr.employees']);
        $platform = $this->platformAdministrator();
        $statesBefore = TenantApplicationState::query()->get()->map->toArray()->all();

        $response = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/plan", [
                'version_id' => $plan->id,
                'starts_at' => '2026-08-23T00:00:00Z',
                'reason' => 'إسناد باقة starter',
            ])
            ->assertCreated()
            ->assertJsonPath('data.source_type', 'plan')
            ->assertJsonPath('data.plan_version_id', $plan->id);

        $assignmentId = $response->json('data.id');
        $this->assertDatabaseHas('tenant_commercial_assignments', [
            'id' => $assignmentId,
            'tenant_id' => $tenant['tenant_id'],
            'commercial_plan_version_id' => $plan->id,
            'status' => TenantCommercialAssignment::STATUS_ACTIVE,
        ]);
        $this->assertDatabaseHas('tenant_commercial_assignment_events', [
            'tenant_commercial_assignment_id' => $assignmentId,
            'action' => TenantCommercialAssignmentEvent::ACTION_ASSIGNED,
        ]);
        $grant = TenantApplicationEntitlement::sole();
        $this->assertSame(EntitlementSourceType::PLAN->value, $grant->source_type);
        $this->assertSame('commercial-plan-version', $grant->source_reference_type);
        $this->assertSame($plan->id, $grant->source_reference_id);
        $this->assertSame($assignmentId, $grant->grant_group_id);
        $this->assertSame($assignmentId, $grant->metadata['commercial_assignment_id']);
        $this->assertSame($statesBefore, TenantApplicationState::query()->get()->map->toArray()->all());

        app(TenantContext::class)->set($tenant['tenant_id']);
        $this->assertSame(TenantApplicationEntitlementDecision::FULL, app(TenantApplicationEntitlementResolver::class)->resolve(
            \App\Models\Tenant::findOrFail($tenant['tenant_id']), 'hr.employees', now('UTC'),
        ));
        $applicationResponse = $this->withToken($tenant['token'])->getJson('/api/applications')->assertOk();
        $application = $applicationResponse->json('data')['hr.employees'];
        $this->assertSame('included', $application['commercial']['availability']);
        $this->assertSame('full', $application['effective_access']);
    }

    /** @test */
    public function preview_is_read_only_and_addon_assignment_is_idempotent_and_tenant_isolated(): void
    {
        $tenantA = $this->registerTenant('commercial-addon-a', 'owner@commercial-addon-a.test');
        $tenantB = $this->registerTenant('commercial-addon-b', 'owner@commercial-addon-b.test');
        $addon = $this->publishedAddon('addon-hr', ['hr.employees']);
        $platform = $this->platformAdministrator();
        $payload = ['version_id' => $addon->id, 'starts_at' => '2026-08-23T00:00:00Z'];

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-assignments/preview", ['source_type' => 'addon', ...$payload])
            ->assertOk()
            ->assertJsonPath('data.target_version_id', $addon->id)
            ->assertJsonPath('data.grants_to_create.0.capability_key', 'hr.employees');
        $this->assertSame(0, TenantCommercialAssignment::count());
        $this->assertSame(0, TenantApplicationEntitlement::count());

        $first = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-assignments/addon", $payload)
            ->assertCreated();
        $second = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-assignments/addon", $payload)
            ->assertOk();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        app(TenantContext::class)->set($tenantA['tenant_id']);
        $this->assertSame(1, TenantCommercialAssignment::count());
        $this->assertSame(1, TenantApplicationEntitlement::count());
        $this->assertDatabaseHas('tenant_application_entitlements', [
            'tenant_id' => $tenantA['tenant_id'],
            'source_type' => EntitlementSourceType::ADDON->value,
            'source_reference_id' => $addon->id,
        ]);
        app(TenantContext::class)->set($tenantB['tenant_id']);
        $this->assertSame(0, TenantApplicationEntitlement::count());
        $this->assertDatabaseMissing('tenant_application_entitlements', ['tenant_id' => $tenantB['tenant_id']]);
    }

    /** @test */
    public function cancellation_and_revocation_keep_assignment_history_and_revoke_only_the_assignment_group(): void
    {
        $tenant = $this->registerTenant('commercial-history', 'owner@commercial-history.test');
        $addon = $this->publishedAddon('addon-history', ['hr.employees']);
        $platform = $this->platformAdministrator();
        $assigned = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/addon", ['version_id' => $addon->id, 'starts_at' => '2026-08-23T00:00:00Z'])
            ->assertCreated();
        $assignmentId = $assigned->json('data.id');

        app(TenantContext::class)->set($tenant['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($tenant['tenant_id']), 'sales.invoicing', EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER, now('UTC'), null, 'legacy-backfill', $tenant['tenant_id'], null, 'LEGACY_REACHABLE',
        );
        app(TenantContext::class)->forget();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/commercial-assignments/{$assignmentId}/cancel", ['reason' => 'إلغاء المصدر'])
            ->assertOk()
            ->assertJsonPath('data.status', TenantCommercialAssignment::STATUS_CANCELLED);

        $this->assertDatabaseHas('tenant_commercial_assignment_events', [
            'tenant_commercial_assignment_id' => $assignmentId,
            'action' => TenantCommercialAssignmentEvent::ACTION_CANCELLED,
        ]);
        $this->assertNotNull(TenantApplicationEntitlement::where('grant_group_id', $assignmentId)->sole()->revoked_at);
        $this->assertNull(TenantApplicationEntitlement::where('source_type', EntitlementSourceType::LEGACY_GRANDFATHER->value)->sole()->revoked_at);
    }

    /** @test */
    public function commercial_assignment_endpoints_reject_tenant_and_read_only_platform_tokens(): void
    {
        $tenant = $this->registerTenant('commercial-auth', 'owner@commercial-auth.test');
        [$plan] = $this->publishedPlan('auth-plan', ['hr.employees']);
        $readOnly = $this->platformAdministrator(['platform:read']);
        $payload = ['version_id' => $plan->id, 'starts_at' => '2026-08-23T00:00:00Z'];

        $this->withToken($tenant['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/plan", $payload)
            ->assertForbidden();
        $this->withToken($readOnly['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/plan", $payload)
            ->assertForbidden();
        $this->assertSame(0, TenantCommercialAssignment::count());
    }
}
