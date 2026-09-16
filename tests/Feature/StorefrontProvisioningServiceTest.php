<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\StorefrontHostnameConflictException;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * COM-STORE-PROVISION-1 — `StorefrontProvisioningService` عند مستوى الخدمة:
 * الرسم البياني الناتج، التقارب المثالي التكرار، الفشل المغلق عند الغموض/
 * التعارض/الإعداد الناقص، وحدود الثقة بنطاق `awj_subdomain` المُدار مقابل
 * `custom` المملوك للتاجر.
 *
 * تشغيل: php artisan test --filter=StorefrontProvisioningServiceTest
 */
class StorefrontProvisioningServiceTest extends TestCase
{
    use RefreshDatabase;

    private function makeTenant(string $slug = 'alrshd', string $name = 'الرشد'): Tenant
    {
        return Tenant::create([
            'name' => $name,
            'slug' => $slug,
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
            'is_active' => true,
        ]);
    }

    private function provision(Tenant $tenant, ?string $name = null): array
    {
        app(TenantContext::class)->set($tenant->id);
        try {
            return app(StorefrontProvisioningService::class)->provisionFirstStorefrontForCurrentTenant($name);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function provisioning_creates_the_full_graph_active_web_channel_storefront_and_verified_managed_domain(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $tenant = $this->makeTenant('alrshd');

        $result = $this->provision($tenant);

        $this->assertTrue($result['created']);
        $this->assertSame('https://alrshd.store.awjdev.xyz/', $result['preview_url']);
        $this->assertTrue($result['is_active']);

        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::query()->where('type', SalesChannel::TYPE_WEB)->sole();
        $storefront = Storefront::query()->sole();
        $domain = StorefrontDomain::query()->sole();
        app(TenantContext::class)->forget();

        $this->assertSame($tenant->id, $channel->tenant_id);
        $this->assertTrue($channel->is_active);
        $this->assertSame($storefront->id, $result['id']);
        $this->assertSame($channel->id, $storefront->sales_channel_id);
        $this->assertSame($channel->id, $result['sales_channel_id']);
        $this->assertSame('alrshd.store.awjdev.xyz', $domain->hostname);
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $domain->type);
        $this->assertTrue($domain->isVerified());
        $this->assertTrue($domain->is_active);
        $this->assertTrue($domain->is_primary);
        $this->assertSame($tenant->id, $domain->tenant_id);
        $this->assertSame($storefront->id, $domain->storefront_id);
    }

    /** @test */
    public function provisioning_uses_a_custom_display_name_only_when_creating_a_new_storefront(): void
    {
        $tenant = $this->makeTenant('named');

        $result = $this->provision($tenant, 'متجر مخصص');

        $this->assertSame('متجر مخصص', $result['name']);
    }

    /** @test */
    public function repeated_provisioning_is_idempotent_and_does_not_duplicate_anything(): void
    {
        $tenant = $this->makeTenant('repeat');

        $first = $this->provision($tenant);
        $second = $this->provision($tenant);

        $this->assertTrue($first['created']);
        $this->assertFalse($second['created']);
        $this->assertSame($first['id'], $second['id']);
        $this->assertSame($first['sales_channel_id'], $second['sales_channel_id']);
        $this->assertSame($first['preview_url'], $second['preview_url']);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(1, SalesChannel::query()->count());
        $this->assertSame(1, Storefront::query()->count());
        $this->assertSame(1, StorefrontDomain::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function provisioning_reactivates_an_existing_inactive_compatible_storefront_instead_of_duplicating(): void
    {
        $tenant = $this->makeTenant('reactivate');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'متجر معطّل', 'sales_channel_id' => $channel->id, 'is_active' => false,
        ]);
        app(TenantContext::class)->forget();

        $result = $this->provision($tenant);

        $this->assertSame($storefront->id, $result['id']);
        $this->assertTrue($result['is_active']);
        $this->assertTrue($storefront->fresh()->is_active);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(1, Storefront::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function ambiguous_multiple_active_web_channels_fail_closed_without_creating_anything(): void
    {
        $tenant = $this->makeTenant('ambiguous-channel');
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'web', 'name' => 'أ', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        SalesChannel::create(['slug' => 'web-2', 'name' => 'ب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->expectException(RuntimeException::class);

        try {
            $this->provision($tenant);
        } finally {
            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(0, Storefront::query()->count());
            $this->assertSame(0, StorefrontDomain::query()->count());
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function an_incompatible_channel_occupying_the_web_slug_fails_closed(): void
    {
        $tenant = $this->makeTenant('incompatible-slug');
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'web', 'name' => 'نقطة بيع', 'type' => SalesChannel::TYPE_POS, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->expectException(RuntimeException::class);
        $this->provision($tenant);
    }

    /** @test */
    public function a_hostname_already_owned_by_another_tenant_fails_closed_and_does_not_reassign_it(): void
    {
        $other = $this->makeTenant('other-owner', 'مستأجر آخر');
        app(TenantContext::class)->set($other->id);
        $otherChannel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $otherStorefront = Storefront::create(['slug' => 'main', 'name' => 'متجر آخر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true]);
        // Forged collision: a StorefrontDomain row that happens to carry the exact
        // hostname `alrshd` would generate, owned by a different tenant/storefront —
        // proves fail-closed behaviour without relying on (impossible, given global
        // tenants.slug uniqueness) natural slug collision.
        StorefrontDomain::create([
            'storefront_id' => $otherStorefront->id,
            'hostname' => 'alrshd.store.awj.app',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $tenant = $this->makeTenant('alrshd', 'الرشد');

        $this->expectException(StorefrontHostnameConflictException::class);

        try {
            $this->provision($tenant);
        } finally {
            app(TenantContext::class)->set($other->id);
            $this->assertSame('alrshd.store.awj.app', StorefrontDomain::query()->sole()->hostname);
            $this->assertSame($other->id, StorefrontDomain::query()->sole()->tenant_id);
            app(TenantContext::class)->forget();

            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(0, Storefront::query()->count());
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function a_managed_hostname_manually_registered_as_a_custom_domain_is_never_reclassified_automatically(): void
    {
        $tenant = $this->makeTenant('manual', 'يدوي');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'متجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'manual.store.awj.app',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(StorefrontHostnameConflictException::class);

        $this->provision($tenant);
    }

    /** @test */
    public function missing_managed_base_domain_configuration_fails_closed_before_creating_anything(): void
    {
        config(['storefront.managed_base_domain' => null]);
        $tenant = $this->makeTenant('no-config');

        $this->expectException(StorefrontBaseDomainMisconfiguredException::class);

        try {
            $this->provision($tenant);
        } finally {
            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(0, SalesChannel::query()->count());
            $this->assertSame(0, Storefront::query()->count());
            $this->assertSame(0, StorefrontDomain::query()->count());
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function an_invalid_managed_base_domain_configuration_fails_closed_before_creating_anything(): void
    {
        config(['storefront.managed_base_domain' => 'not a valid host!!']);
        $tenant = $this->makeTenant('bad-config');

        $this->expectException(StorefrontBaseDomainMisconfiguredException::class);

        try {
            $this->provision($tenant);
        } finally {
            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(0, SalesChannel::query()->count());
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function changing_the_configured_base_domain_changes_the_generated_hostname_with_no_code_change(): void
    {
        config(['storefront.managed_base_domain' => 'store.awj.app']);
        $tenant = $this->makeTenant('futuredom');

        $result = $this->provision($tenant);

        $this->assertSame('https://futuredom.store.awj.app/', $result['preview_url']);
    }
}
