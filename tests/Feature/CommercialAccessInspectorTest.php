<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\CommercialAssignmentService;
use App\Services\CommercialProductVersionService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialAccessInspectorTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function platform_admin_can_inspect_commercial_sources_without_mutation_and_tenant_tokens_are_denied(): void
    {
        $tenantAuth = $this->registerTenant('inspector-a', 'owner@inspector-a.test', autoEnableApplications: true);
        $tenant = Tenant::findOrFail($tenantAuth['tenant_id']);
        $product = CommercialProduct::create(['code' => 'inspector-hr', 'name' => 'Inspector HR']);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($version, ['hr.employees']);
        $products->publish($version);
        app(CommercialAssignmentService::class)->assignAddon($tenant, null, $version, CarbonImmutable::parse('2026-01-01T00:00:00Z'));
        $admin = PlatformAdministrator::create(['name' => 'Inspector Admin', 'email' => 'inspector+' . uniqid() . '@nebrax.test', 'password' => 'platform-password-123']);
        $token = $admin->createToken('inspect', ['platform:manage'])->plainTextToken;

        $this->withToken($tenantAuth['token'])->getJson("/api/platform/tenants/{$tenant->id}/commercial-access/hr.employees")->assertForbidden();
        $this->withToken($token)->getJson("/api/platform/tenants/{$tenant->id}/commercial-access/hr.employees?operation=read&at=2026-01-02T00:00:00Z")
            ->assertOk()
            ->assertJsonPath('data.effective_access.level', 'allowed')
            ->assertJsonPath('data.commercial_sources.0.source_type', 'addon')
            ->assertJsonPath('data.tenant_application_state.status', 'enabled')
            ->assertJsonPath('data.rbac.evaluated', false);
    }

    /** @test */
    public function inspector_rejects_unknown_operation_class_without_writing(): void
    {
        $tenant = $this->registerTenant('inspector-b', 'owner@inspector-b.test');
        $admin = PlatformAdministrator::create(['name' => 'Inspector Admin B', 'email' => 'inspector-b+' . uniqid() . '@nebrax.test', 'password' => 'platform-password-123']);
        $token = $admin->createToken('inspect-b', ['platform:manage'])->plainTextToken;

        $this->withToken($token)->getJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-access/hr.employees?operation=unknown")->assertStatus(422);
    }
}
