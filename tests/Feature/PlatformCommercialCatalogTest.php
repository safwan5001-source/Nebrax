<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Services\CommercialProductVersionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformCommercialCatalogTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function catalog_read_publish_and_retire_are_platform_admin_only_and_idempotent(): void
    {
        $tenant = $this->registerTenant('catalog-tenant', 'owner@catalog-tenant.test');
        $product = CommercialProduct::create(['code' => 'catalog-hr', 'name' => 'Catalog HR']);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        app(CommercialProductVersionService::class)->setCapabilities($version, ['hr.employees']);
        $admin = PlatformAdministrator::create(['name' => 'Catalog Admin', 'email' => 'catalog+' . uniqid() . '@nebrax.test', 'password' => 'platform-password-123']);
        $manage = $admin->createToken('catalog-manage', ['platform:manage'])->plainTextToken;
        $read = $admin->createToken('catalog-read', ['platform:read'])->plainTextToken;

        $this->withToken($tenant['token'])->getJson('/api/platform/commercial-catalog')->assertForbidden();
        $this->withToken($read)->postJson("/api/platform/commercial-product-versions/{$version->id}/publish")->assertForbidden();
        $this->withToken($manage)->postJson("/api/platform/commercial-product-versions/{$version->id}/publish")->assertOk()->assertJsonPath('data.id', $version->id);
        $this->withToken($manage)->postJson("/api/platform/commercial-product-versions/{$version->id}/publish")->assertOk();
        $this->withToken($manage)->getJson('/api/platform/commercial-catalog')->assertOk()->assertJsonPath('data.products.0.code', 'catalog-hr');
        $this->withToken($manage)->postJson("/api/platform/commercial-product-versions/{$version->id}/retire")->assertOk();
        $this->assertNotNull($version->fresh()->retired_at);
    }
}
