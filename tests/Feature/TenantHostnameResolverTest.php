<?php

namespace Tests\Feature;

use App\Support\HostnameNormalizer;
use App\Tenancy\ReservedTenantSlugs;
use App\Tenancy\TenantHostnameResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * حسم slug النطاق الفرعي لمستأجر ERP — دون StorefrontDomain.
 * تشغيل: php artisan test --filter=TenantHostnameResolverTest
 */
class TenantHostnameResolverTest extends TestCase
{
    use RefreshDatabase;

    private function resolver(): TenantHostnameResolver
    {
        return app(TenantHostnameResolver::class);
    }

    /** @test */
    public function a_valid_awj_subdomain_extracts_the_tenant_slug(): void
    {
        $this->assertSame('alnoor', $this->resolver()->extractSlug('alnoor.awj.app'));
        $this->assertSame('alnoor', $this->resolver()->extractSlug('https://AlNoor.AWJ.APP:443/login'));
    }

    /** @test */
    public function unknown_or_malformed_hosts_do_not_establish_a_tenant_slug(): void
    {
        $this->assertNull($this->resolver()->extractSlug('localhost'));
        $this->assertNull($this->resolver()->extractSlug('127.0.0.1'));
        $this->assertNull($this->resolver()->extractSlug('nibras-api.onrender.com'));
        $this->assertNull($this->resolver()->extractSlug('nebrax.vercel.app'));
        $this->assertNull($this->resolver()->extractSlug('awj.app'));
        $this->assertNull($this->resolver()->extractSlug('foo.bar.awj.app'));
        $this->assertNull($this->resolver()->extractSlug('shop..example.com'));
        $this->assertNull($this->resolver()->extractSlug('   '));
    }

    /** @test */
    public function reserved_infrastructure_labels_are_not_tenant_mode(): void
    {
        foreach (ReservedTenantSlugs::all() as $slug) {
            $this->assertTrue(ReservedTenantSlugs::contains($slug));
            $this->assertNull($this->resolver()->extractSlug($slug.'.awj.app'), $slug);
        }

        foreach (['www', 'api', 'app', 'admin', 'platform', 'support'] as $required) {
            $this->assertTrue(ReservedTenantSlugs::contains($required), $required);
        }
    }

    /** @test */
    public function hostname_normalization_is_delegated_to_the_shared_normalizer(): void
    {
        $this->assertSame(
            HostnameNormalizer::normalize('https://AlNoor.AWJ.APP:8443/path'),
            'alnoor.awj.app',
        );
        $this->assertSame('alnoor', $this->resolver()->extractSlug('https://AlNoor.AWJ.APP:8443/path'));
    }

    /** @test */
    public function a_configurable_base_domain_is_honoured_for_local_hosts(): void
    {
        config(['tenancy.base_domains' => ['localhost', 'awj.app']]);

        $this->assertSame('alnoor', $this->resolver()->extractSlug('alnoor.localhost'));
        $this->assertNull($this->resolver()->extractSlug('localhost'));
    }
}
