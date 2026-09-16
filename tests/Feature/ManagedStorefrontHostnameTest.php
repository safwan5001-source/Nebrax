<?php

namespace Tests\Feature;

use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use Tests\TestCase;

/**
 * COM-STORE-PROVISION-1 — حدّ الثقة النقي لنطاقات Commerce المُدارة: توليد
 * hostname بالضبط تحت النطاق الأساسي المُهيَّأ، ورفض هجمات اللاحقة/التشابه
 * النصي بلا حدّ فاصل حقيقي.
 *
 * تشغيل: php artisan test --filter=ManagedStorefrontHostnameTest
 */
class ManagedStorefrontHostnameTest extends TestCase
{
    /** @test */
    public function it_generates_the_expected_hostname_exactly_beneath_the_configured_base_domain(): void
    {
        $this->assertSame(
            'alrshd.store.awjdev.xyz',
            ManagedStorefrontHostname::forSlug('alrshd', 'store.awjdev.xyz'),
        );
    }

    /** @test */
    public function it_reads_the_configured_base_domain_when_none_is_passed_explicitly(): void
    {
        config(['storefront.managed_base_domain' => 'store.awj.app']);

        $this->assertSame('acme.store.awj.app', ManagedStorefrontHostname::forSlug('acme'));
    }

    /**
     * @test
     * @dataProvider lookalikeSuffixAttacks
     */
    public function suffix_and_lookalike_hostnames_are_never_considered_under_the_base_domain(string $candidate): void
    {
        $this->assertFalse(
            ManagedStorefrontHostname::isUnderBaseDomain($candidate, 'store.awjdev.xyz'),
        );
    }

    public static function lookalikeSuffixAttacks(): array
    {
        return [
            'suffix appended after the real base domain' => ['store.awjdev.xyz.evil.com'],
            'tenant hostname suffix appended after the real base domain' => ['alrshd.store.awjdev.xyz.evil.com'],
            'lookalike label that merely starts with the base domain text' => ['evilstore.awjdev.xyz'],
            'the base domain itself is not a tenant subdomain' => ['store.awjdev.xyz'],
            'unrelated domain entirely' => ['evil.com'],
            'empty string' => [''],
            'two extra labels beneath the base domain' => ['a.b.store.awjdev.xyz'],
        ];
    }

    /** @test */
    public function it_accepts_exactly_one_label_beneath_the_base_domain(): void
    {
        $this->assertTrue(
            ManagedStorefrontHostname::isUnderBaseDomain('alrshd.store.awjdev.xyz', 'store.awjdev.xyz'),
        );
    }

    /** @test */
    public function a_missing_configured_base_domain_fails_closed(): void
    {
        config(['storefront.managed_base_domain' => null]);

        $this->expectException(StorefrontBaseDomainMisconfiguredException::class);
        ManagedStorefrontHostname::configuredBaseDomain();
    }

    /** @test */
    public function a_wildcard_configured_base_domain_fails_closed(): void
    {
        config(['storefront.managed_base_domain' => '*.store.awjdev.xyz']);

        $this->expectException(StorefrontBaseDomainMisconfiguredException::class);
        ManagedStorefrontHostname::configuredBaseDomain();
    }

    /** @test */
    public function the_configured_base_domain_is_normalized_lowercase(): void
    {
        $this->assertSame('x.store.awjdev.xyz', ManagedStorefrontHostname::forSlug('x', 'STORE.AwjDev.XYZ'));
    }
}
