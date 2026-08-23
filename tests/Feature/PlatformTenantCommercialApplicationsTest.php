<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantCommercialAssignment;
use App\Services\CommercialProductVersionService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformTenantCommercialApplicationsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{administrator: PlatformAdministrator,token: string} */
    private function platformAdministrator(array $abilities = ['platform:read', 'platform:manage']): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير التطبيقات التجارية',
            'email' => 'commercial-apps+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            'administrator' => $administrator,
            'token' => $administrator->createToken('commercial-applications', $abilities)->plainTextToken,
        ];
    }

    private function publishedAddon(string $code, array $capabilities): CommercialProductVersion
    {
        $product = CommercialProduct::create(['code' => $code, 'name' => 'منتج ' . $code]);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $service = app(CommercialProductVersionService::class);
        $service->setCapabilities($version, $capabilities);

        return $service->publish($version);
    }

    /** @test */
    public function platform_admin_reads_tenant_commercial_summary_without_exposing_it_to_tenant_users(): void
    {
        $tenant = $this->registerTenant('commercial-summary', 'owner@commercial-summary.test');
        $addon = $this->publishedAddon('platform-commercial-test-addon', ['fuel_stations.core']);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/addon", [
                'version_id' => $addon->id,
                'starts_at' => now('UTC')->subMinute()->toIso8601String(),
                'reason' => 'اختبار ملخص الإضافة',
            ])
            ->assertCreated();

        app(TenantContext::class)->set($tenant['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenant['tenant_id']),
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now('UTC')->subMinute(),
            null,
            'legacy-summary',
            $tenant['tenant_id'],
        );
        app(TenantContext::class)->forget();

        $this->withToken($platform['token'])
            ->getJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-applications")
            ->assertOk()
            ->assertJsonPath('data.commercial_summary.active_addons.0.product_version.product_code', 'platform-commercial-test-addon')
            ->assertJsonPath('data.commercial_summary.legacy_entitlements.0.capability_key', 'sales.invoicing')
            ->assertJsonFragment(['key' => 'fuel_stations.core', 'effective_access' => 'full']);

        $this->withToken($tenant['token'])
            ->getJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-applications")
            ->assertForbidden();
    }

    /** @test */
    public function trial_preview_is_read_only_and_reports_a_historical_trial_conflict(): void
    {
        $tenant = $this->registerTenant('commercial-trial-preview', 'owner@commercial-trial-preview.test');
        $addon = $this->publishedAddon('platform-commercial-test-addon', ['fuel_stations.core']);
        $platform = $this->platformAdministrator();
        $payload = [
            'source_type' => 'trial',
            'trial_target' => 'addon',
            'version_id' => $addon->id,
            'starts_at' => now('UTC')->toIso8601String(),
            'duration_days' => 14,
        ];

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/preview", $payload)
            ->assertOk()
            ->assertJsonPath('data.source_type', 'trial')
            ->assertJsonPath('data.trial_duration_days', 14)
            ->assertJsonPath('data.grants_to_create.0.capability_key', 'fuel_stations.core');
        $this->assertSame(0, TenantCommercialAssignment::count());

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-trials/addon", [
                'version_id' => $addon->id,
                'starts_at' => now('UTC')->toIso8601String(),
                'duration_days' => 14,
            ])
            ->assertCreated();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/preview", $payload)
            ->assertOk()
            ->assertJsonCount(1, 'data.conflicts');
    }

    /** @test */
    public function tenant_scoped_lifecycle_actions_cannot_target_another_tenants_assignment(): void
    {
        $tenantA = $this->registerTenant('commercial-scope-a', 'owner@commercial-scope-a.test');
        $tenantB = $this->registerTenant('commercial-scope-b', 'owner@commercial-scope-b.test');
        $addon = $this->publishedAddon('platform-commercial-test-addon', ['fuel_stations.core']);
        $platform = $this->platformAdministrator();

        $created = $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/commercial-assignments/addon", [
                'version_id' => $addon->id,
                'starts_at' => now('UTC')->subMinute()->toIso8601String(),
            ])
            ->assertCreated();
        $assignmentId = $created->json('data.id');

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantB['tenant_id']}/commercial-assignments/{$assignmentId}/cancel", ['reason' => 'محاولة عابرة للمستأجر'])
            ->assertNotFound();

        $this->assertDatabaseHas('tenant_commercial_assignments', [
            'id' => $assignmentId,
            'tenant_id' => $tenantA['tenant_id'],
            'status' => TenantCommercialAssignment::STATUS_ACTIVE,
        ]);
    }
}
